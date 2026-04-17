import bcrypt from "bcryptjs";
import crypto from "crypto";
import mongoose from "mongoose";

import type { AppRole } from "../constants/roles";
import Department from "../models/Department";
import Designation from "../models/Designation";
import User from "../models/User";
import { sendEmail } from "./mailService";

const SUPER_ADMIN_ROLE: AppRole = "superadmin";
const ADMIN_ROLE: AppRole = "admin";

type UserStatus = "Active" | "Inactive";

type UserMutationInput = {
  name: string;
  email: string;
  role: AppRole;
  joiningDate: Date;
  teamLeaderId?: string | null;
  departmentId?: string | null;
  designationId?: string | null;
  status?: UserStatus;
  isActive?: boolean;
};

type ListUsersInput = {
  page: number;
  limit: number;
  search: string;
  status: string;
};

type UserListItem = {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  role: AppRole;
  isActive: boolean;
  status: UserStatus;
  joiningDate: Date;
  teamLeaderId: mongoose.Types.ObjectId | null;
  teamLeaderName: string;
  department: string;
  designation: string;
};

export class UserServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeName(name: string) {
  return name.trim();
}

function generateUsername(email: string) {
  return normalizeEmail(email).split("@")[0];
}

function isAdminRole(role: AppRole) {
  return role === ADMIN_ROLE;
}

function isDuplicateKeyError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

export function normalizeUserStatus(isActive: boolean): UserStatus {
  return isActive ? "Active" : "Inactive";
}

export function buildActiveUserFilter(isActive = true) {
  if (isActive) {
    return {
      $or: [{ isActive: true }, { isActive: { $exists: false }, status: "Active" }]
    };
  }

  return {
    $or: [{ isActive: false }, { isActive: { $exists: false }, status: "Inactive" }]
  };
}

export async function getTeamMemberIdsByLeader(teamLeaderId: string) {
  const teamMembers = await User.find({
    teamLeaderId,
    role: "employee",
    isDeleted: false
  })
    .select("_id")
    .lean();

  return teamMembers.map((member) => String(member._id));
}

async function resolveUserRelations(role: AppRole, departmentId?: string | null, designationId?: string | null) {
  if (isAdminRole(role)) {
    return {
      department: null,
      designation: null
    };
  }

  if (!departmentId || !designationId) {
    throw new UserServiceError(400, "Department and Designation are required");
  }

  if (!mongoose.Types.ObjectId.isValid(departmentId) || !mongoose.Types.ObjectId.isValid(designationId)) {
    throw new UserServiceError(400, "Invalid Department or Designation");
  }

  const [departmentExists, designationExists] = await Promise.all([
    Department.exists({
      _id: departmentId,
      isDeleted: false
    }),
    Designation.exists({
      _id: designationId,
      department: departmentId,
      isDeleted: false
    })
  ]);

  if (!departmentExists || !designationExists) {
    throw new UserServiceError(400, "Invalid Department or Designation");
  }

  return {
    department: new mongoose.Types.ObjectId(departmentId),
    designation: new mongoose.Types.ObjectId(designationId)
  };
}

async function resolveTeamLeader(teamLeaderId?: string | null) {
  if (!teamLeaderId) {
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(teamLeaderId)) {
    throw new UserServiceError(400, "Invalid team leader");
  }

  const teamLeader = await User.findOne({
    _id: teamLeaderId,
    role: "teamLeader",
    isDeleted: false,
    ...buildActiveUserFilter(true)
  })
    .select("_id")
    .lean();

  if (!teamLeader) {
    throw new UserServiceError(400, "Selected team leader is invalid or inactive");
  }

  return new mongoose.Types.ObjectId(teamLeaderId);
}

function sendAccountCreationEmail(email: string, rawPassword: string) {
  void sendEmail({
    to: email,
    subject: "EMS Account Created",
    htmlContent: `
      <h3>Your EMS Account Details</h3>
      <p><b>Username:</b> ${email}</p>
      <p><b>Password:</b> ${rawPassword}</p>
      <p>Please change your password after first login.</p>
    `,
    context: "user.create.accountEmail"
  }).catch((error) => {
    console.error("Failed to send account creation email", error);
  });
}

export async function createUserAccount(input: UserMutationInput) {
  if (!input.name?.trim() || !input.email?.trim() || !input.role || !input.joiningDate) {
    throw new UserServiceError(400, "Missing required fields");
  }

  const email = normalizeEmail(input.email);
  const name = normalizeName(input.name);
  const isActive = input.isActive ?? input.status !== "Inactive";
  const status = normalizeUserStatus(isActive);

  const [existingUser, relations, teamLeader] = await Promise.all([
    User.exists({
      email,
      isDeleted: false
    }),
    resolveUserRelations(input.role, input.departmentId, input.designationId),
    resolveTeamLeader(input.teamLeaderId)
  ]);

  if (existingUser) {
    throw new UserServiceError(400, "User with this email already exists");
  }

  const rawPassword = crypto.randomBytes(4).toString("hex");
  const hashedPassword = await bcrypt.hash(rawPassword, 10);

  try {
    const user = await User.create({
      name,
      email,
      username: generateUsername(email),
      password: hashedPassword,
      role: input.role,
      department: relations.department,
      designation: relations.designation,
      joiningDate: input.joiningDate,
      teamLeaderId: input.role === "employee" ? teamLeader : null,
      isActive,
      status
    });

    sendAccountCreationEmail(email, rawPassword);

    return {
      id: String(user._id)
    };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new UserServiceError(400, "User with this email already exists");
    }

    throw error;
  }
}

export async function updateUserAccount(userId: string, input: UserMutationInput) {
  if (!input.name?.trim() || !input.email?.trim() || !input.role || !input.joiningDate) {
    throw new UserServiceError(400, "Missing required fields");
  }

  if (input.teamLeaderId && String(input.teamLeaderId) === String(userId)) {
    throw new UserServiceError(400, "A user cannot be their own team leader");
  }

  const email = normalizeEmail(input.email);
  const name = normalizeName(input.name);
  const isActive = input.isActive ?? input.status !== "Inactive";
  const status = normalizeUserStatus(isActive);

  const [existingEmail, relations, teamLeader] = await Promise.all([
    User.exists({
      email,
      _id: { $ne: userId },
      isDeleted: false
    }),
    resolveUserRelations(input.role, input.departmentId, input.designationId),
    resolveTeamLeader(input.teamLeaderId)
  ]);

  if (existingEmail) {
    throw new UserServiceError(400, "User with this email already exists");
  }

  const updatePayload = {
    name,
    email,
    role: input.role,
    joiningDate: input.joiningDate,
    teamLeaderId: input.role === "employee" ? teamLeader : null,
    isActive,
    status,
    department: relations.department,
    designation: relations.designation
  };

  const updatedUser = await User.findOneAndUpdate(
    { _id: userId, isDeleted: false },
    updatePayload,
    {
      returnDocument: "after"
    }
  ).select("_id");

  if (!updatedUser) {
    throw new UserServiceError(404, "User not found");
  }

  return {
    id: String(updatedUser._id)
  };
}

export async function listUsers(input: ListUsersInput) {
  const skip = (input.page - 1) * input.limit;
  const filter: Record<string, unknown> = {
    isDeleted: false,
    role: { $ne: SUPER_ADMIN_ROLE }
  };

  if (input.status) {
    filter.$and = [buildActiveUserFilter(input.status === "Active")];
  }

  if (input.search) {
    const regex = new RegExp(input.search, "i");
    filter.$or = [{ name: regex }, { email: regex }];
  }

  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.aggregate<UserListItem>([
      { $match: filter },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: input.limit },
      {
        $lookup: {
          from: "users",
          localField: "teamLeaderId",
          foreignField: "_id",
          as: "teamLeaderDoc",
          pipeline: [{ $project: { _id: 1, name: 1 } }]
        }
      },
      {
        $lookup: {
          from: "departments",
          localField: "department",
          foreignField: "_id",
          as: "departmentDoc",
          pipeline: [{ $project: { _id: 0, name: 1 } }]
        }
      },
      {
        $lookup: {
          from: "designations",
          localField: "designation",
          foreignField: "_id",
          as: "designationDoc",
          pipeline: [{ $project: { _id: 0, name: 1 } }]
        }
      },
      {
        $project: {
          _id: 1,
          name: 1,
          email: 1,
          role: 1,
          isActive: { $ifNull: ["$isActive", { $eq: ["$status", "Active"] }] },
          status: {
            $ifNull: [
              "$status",
              {
                $cond: [{ $eq: ["$isActive", false] }, "Inactive", "Active"]
              }
            ]
          },
          joiningDate: 1,
          teamLeaderId: 1,
          teamLeaderName: {
            $ifNull: [{ $arrayElemAt: ["$teamLeaderDoc.name", 0] }, ""]
          },
          department: {
            $ifNull: [{ $arrayElemAt: ["$departmentDoc.name", 0] }, ""]
          },
          designation: {
            $ifNull: [{ $arrayElemAt: ["$designationDoc.name", 0] }, ""]
          }
        }
      }
    ])
  ]);

  return {
    items: users,
    total,
    page: input.page,
    limit: input.limit,
    totalPages: Math.ceil(total / input.limit)
  };
}
