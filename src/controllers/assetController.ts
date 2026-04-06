import type { Request, Response } from "express";
import Asset from "../models/Asset";
import AssetAllocation from "../models/AssetAllocation";
import User from "../models/User";
import { badRequest, created, notFound, ok, serverError } from "../utils/apiResponse";
import { logServerError } from "../utils/serverLogger";

type AssetPayloadKey =
  | "assetCode"
  | "serialNo"
  | "name"
  | "category"
  | "brand"
  | "model"
  | "purchaseDate"
  | "warrantyEndDate"
  | "cost"
  | "status";

const ASSET_PAYLOAD_KEYS: AssetPayloadKey[] = [
  "assetCode",
  "serialNo",
  "name",
  "category",
  "brand",
  "model",
  "purchaseDate",
  "warrantyEndDate",
  "cost",
  "status"
];

function pickAssetPayload(body: Request["body"]) {
  return ASSET_PAYLOAD_KEYS.reduce<Record<string, unknown>>((acc, key) => {
    if (body?.[key] !== undefined) {
      acc[key] = body[key];
    }
    return acc;
  }, {});
}

export const listAssets = async (req: Request, res: Response) => {
  try {
    const query = req.query as {
      q?: string;
      status?: string;
      category?: string;
      page?: string;
      limit?: string;
    };

    const filter: Record<string, unknown> = { isDeleted: false };
    if (query.status) filter.status = query.status;
    if (query.category) filter.category = query.category;

    if (query.q) {
      const regex = new RegExp(String(query.q), "i");
      const matchedUsers = await User.find({
        isDeleted: false,
        $or: [{ name: regex }, { email: regex }, { username: regex }]
      })
        .select("_id")
        .lean();
      const matchedUserIds = matchedUsers.map((user) => user._id);
      const matchedAllocations = matchedUserIds.length
        ? await AssetAllocation.find({
            employeeId: { $in: matchedUserIds },
            returnedOn: null
          })
            .select("assetId")
            .lean()
        : [];
      const matchedAssetIds = matchedAllocations.map((allocation) => allocation.assetId);

      filter.$or = [
        { assetCode: regex },
        { serialNo: regex },
        { name: regex },
        { brand: regex },
        { model: regex },
        ...(matchedAssetIds.length ? [{ _id: { $in: matchedAssetIds } }] : [])
      ];
    }

    const page = Math.max(parseInt(query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(query.limit || "10", 10), 1), 100);

    const [items, total] = await Promise.all([
      Asset.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Asset.countDocuments(filter)
    ]);

    const assetIds = items.map((item) => item._id);
    const currentAllocations = await AssetAllocation.find({
      assetId: { $in: assetIds },
      returnedOn: null
    })
      .populate("employeeId", "name email username role status")
      .lean();

    const currentMap = new Map<string, (typeof currentAllocations)[number]>();
    currentAllocations.forEach((allocation) => currentMap.set(String(allocation.assetId), allocation));

    return ok(res, "Assets fetched successfully", {
      items: items.map((item) => ({
        ...item,
        currentAllocation: currentMap.get(String(item._id)) || null
      })),
      total,
      page,
      limit
    });
  } catch (error) {
    logServerError("asset.list", error);
    return serverError(res, "Failed to load assets");
  }
};

export const createAsset = async (req: Request, res: Response) => {
  try {
    const createdAsset = await Asset.create(pickAssetPayload(req.body));
    return created(res, "Asset created successfully", { asset: createdAsset }, { asset: createdAsset });
  } catch (error) {
    logServerError("asset.create", error);
    return serverError(res, "Failed to create asset");
  }
};

export const updateAsset = async (req: Request, res: Response) => {
  try {
    const updated = await Asset.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      pickAssetPayload(req.body),
      { returnDocument: "after", runValidators: true }
    );

    if (!updated) {
      return notFound(res, "Asset not found");
    }

    return ok(res, "Asset updated successfully", { asset: updated }, { asset: updated });
  } catch (error) {
    logServerError("asset.update", error);
    return serverError(res, "Failed to update asset");
  }
};

export const deleteAsset = async (req: Request, res: Response) => {
  try {
    const current = await AssetAllocation.findOne({
      assetId: req.params.id,
      returnedOn: null
    });
    if (current) {
      return badRequest(res, "Asset is currently allocated. Return it first.");
    }

    const deleted = await Asset.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      { isDeleted: true },
      { returnDocument: "after" }
    );

    if (!deleted) {
      return notFound(res, "Asset not found");
    }

    return ok(res, "Asset deleted", { message: "Asset deleted" });
  } catch (error) {
    logServerError("asset.delete", error);
    return serverError(res, "Failed to delete asset");
  }
};

export const allocateAsset = async (req: Request, res: Response) => {
  try {
    const { id: assetId } = req.params;
    const { employeeId, allocatedOn, expectedReturnOn, notes } = req.body as {
      employeeId: string;
      allocatedOn: string;
      expectedReturnOn?: string;
      notes?: string;
    };

    const asset = await Asset.findOne({ _id: assetId, isDeleted: false });
    if (!asset) return notFound(res, "Asset not found");

    const already = await AssetAllocation.findOne({ assetId, returnedOn: null });
    if (already) return badRequest(res, "Asset is already allocated");

    const employee = await User.findOne({ _id: employeeId, isDeleted: false });
    if (!employee) return notFound(res, "Employee not found");

    const allocated = await AssetAllocation.create({
      assetId,
      employeeId,
      allocatedOn: new Date(allocatedOn),
      expectedReturnOn: expectedReturnOn ? new Date(expectedReturnOn) : undefined,
      returnedOn: null,
      notes
    });

    await Asset.updateOne({ _id: assetId, isDeleted: false }, { status: "ALLOCATED" });

    return created(res, "Asset allocated successfully", { allocation: allocated }, { allocation: allocated });
  } catch (error) {
    logServerError("asset.allocate", error);
    return serverError(res, "Failed to allocate asset");
  }
};

export const returnAsset = async (req: Request, res: Response) => {
  try {
    const { id: assetId } = req.params;
    const { returnedOn, returnCondition, notes } = req.body as {
      returnedOn: string;
      returnCondition?: string;
      notes?: string;
    };

    const current = await AssetAllocation.findOne({ assetId, returnedOn: null });
    if (!current) {
      return badRequest(res, "No active allocation found for this asset");
    }

    const returnDate = new Date(returnedOn);
    if (current.allocatedOn && returnDate < current.allocatedOn) {
      return badRequest(res, "returnedOn cannot be before allocatedOn");
    }

    current.returnedOn = returnDate;
    current.returnCondition = returnCondition;
    if (notes) current.notes = notes;
    await current.save();

    await Asset.updateOne({ _id: assetId }, { status: "IN_STOCK" });

    return ok(res, "Asset returned", { message: "Asset returned", allocation: current }, { allocation: current });
  } catch (error) {
    logServerError("asset.return", error);
    return serverError(res, "Failed to return asset");
  }
};

export const assetHistory = async (req: Request, res: Response) => {
  try {
    const history = await AssetAllocation.find({ assetId: req.params.id })
      .sort({ allocatedOn: -1 })
      .populate("employeeId", "name email username role status")
      .populate("allocatedBy", "name email username role")
      .lean();

    return ok(res, "Asset history fetched successfully", { items: history });
  } catch (error) {
    logServerError("asset.history", error);
    return serverError(res, "Failed to fetch asset history");
  }
};

export const employeeAssets = async (req: Request, res: Response) => {
  try {
    const current = await AssetAllocation.find({ employeeId: req.params.id, returnedOn: null })
      .populate("assetId")
      .lean();

    return ok(res, "Employee assets fetched successfully", { items: current });
  } catch (error) {
    logServerError("asset.employeeAssets", error);
    return serverError(res, "Failed to fetch employee assets");
  }
};

