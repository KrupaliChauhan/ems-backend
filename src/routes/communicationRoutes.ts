import express from "express";
import {
  acknowledgeAnnouncement,
  archiveAnnouncement,
  archiveEvent,
  cancelEvent,
  createAnnouncement,
  createEvent,
  createPolicy,
  deleteAnnouncement,
  deleteEvent,
  getAnnouncementById,
  getAnnouncements,
  getCommunicationDashboard,
  getCommunicationMeta,
  getEventById,
  getEventCalendar,
  getEvents,
  getNotifications,
  getPolicyAcknowledgmentReport,
  getPolicyById,
  getPolicies,
  markAllNotificationsRead,
  markAnnouncementRead,
  markNotificationRead,
  acknowledgePolicy,
  publishAnnouncement,
  publishEvent,
  restoreEvent,
  restoreAnnouncement,
  rsvpToEvent,
  updateAnnouncement,
  updateEvent,
  updatePolicy
} from "../controllers/communicationController";
import { communicationUpload } from "../middleware/uploadCommunicationAssets";
import { protect, requireRoles } from "../middleware/authMiddleware";
import { COMMUNICATION_MANAGER_ROLES } from "../constants/roles";

const router = express.Router();

const uploadFields = communicationUpload.fields([
  { name: "attachments", maxCount: 5 },
  { name: "bannerImage", maxCount: 1 }
]);

router.get("/meta", protect, requireRoles(...COMMUNICATION_MANAGER_ROLES), getCommunicationMeta);
router.get("/dashboard", protect, getCommunicationDashboard);

router.get("/notifications", protect, getNotifications);
router.post("/notifications/read-all", protect, markAllNotificationsRead);
router.post("/notifications/:id/read", protect, markNotificationRead);

router.get("/announcements", protect, getAnnouncements);
router.post("/announcements", protect, requireRoles(...COMMUNICATION_MANAGER_ROLES), uploadFields, createAnnouncement);
router.get("/announcements/:id", protect, getAnnouncementById);
router.put("/announcements/:id", protect, requireRoles(...COMMUNICATION_MANAGER_ROLES), uploadFields, updateAnnouncement);
router.delete("/announcements/:id", protect, requireRoles(...COMMUNICATION_MANAGER_ROLES), deleteAnnouncement);
router.post("/announcements/:id/publish", protect, requireRoles(...COMMUNICATION_MANAGER_ROLES), publishAnnouncement);
router.post("/announcements/:id/archive", protect, requireRoles(...COMMUNICATION_MANAGER_ROLES), archiveAnnouncement);
router.post("/announcements/:id/restore", protect, requireRoles(...COMMUNICATION_MANAGER_ROLES), restoreAnnouncement);
router.post("/announcements/:id/read", protect, markAnnouncementRead);
router.post("/announcements/:id/acknowledge", protect, acknowledgeAnnouncement);

router.get("/policies", protect, getPolicies);
router.post("/policies", protect, requireRoles(...COMMUNICATION_MANAGER_ROLES), createPolicy);
router.get("/policies/:id", protect, getPolicyById);
router.put("/policies/:id", protect, requireRoles(...COMMUNICATION_MANAGER_ROLES), updatePolicy);
router.post("/policies/:id/acknowledge", protect, acknowledgePolicy);
router.get(
  "/policies/:id/acknowledgments",
  protect,
  requireRoles(...COMMUNICATION_MANAGER_ROLES),
  getPolicyAcknowledgmentReport
);

router.get("/events", protect, getEvents);
router.get("/events/calendar", protect, getEventCalendar);
router.post("/events", protect, requireRoles(...COMMUNICATION_MANAGER_ROLES), uploadFields, createEvent);
router.get("/events/:id", protect, getEventById);
router.put("/events/:id", protect, requireRoles(...COMMUNICATION_MANAGER_ROLES), uploadFields, updateEvent);
router.delete("/events/:id", protect, requireRoles(...COMMUNICATION_MANAGER_ROLES), deleteEvent);
router.post("/events/:id/publish", protect, requireRoles(...COMMUNICATION_MANAGER_ROLES), publishEvent);
router.post("/events/:id/cancel", protect, requireRoles(...COMMUNICATION_MANAGER_ROLES), cancelEvent);
router.post("/events/:id/archive", protect, requireRoles(...COMMUNICATION_MANAGER_ROLES), archiveEvent);
router.post("/events/:id/restore", protect, requireRoles(...COMMUNICATION_MANAGER_ROLES), restoreEvent);
router.post("/events/:id/rsvp", protect, rsvpToEvent);

export default router;
