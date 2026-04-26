import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import connectDB from "../config/db";
import Department from "../models/Department";
import Designation from "../models/Designation";
import User from "../models/User";
import Project from "../models/Project";
import Task from "../models/Task";
import LeaveType from "../models/LeaveType";
import LeaveBalance from "../models/LeaveBalance";
import LeaveRequest from "../models/LeaveRequest";
import AttendanceDailySummary from "../models/AttendanceDailySummary";

type RoleKey = "superadmin" | "admin" | "manager" | "hr" | "employee";

type PersonProfile = {
  name: string;
  email: string;
  username: string;
  role: RoleKey;
  departmentName: string;
  designationName: string;
  joiningDate: Date;
  reportsTo?: string;
};

type ProjectPlan = {
  name: string;
  description: string;
  timeLimit: string;
  startDate: Date;
  status: "active" | "pending" | "completed";
  createdByEmail: string;
  leaderEmail: string;
  memberEmails: string[];
};

type TaskPlan = {
  projectName: string;
  title: string;
  description: string;
  createdByEmail: string;
  assignedToEmail: string;
  status: "Pending" | "In Progress" | "In Review" | "Completed";
  priority: "Low" | "Medium" | "High" | "Critical";
  estimatedHours: number;
  dueDate: Date;
};

const COMPANY_DOMAIN = "auroraems.in";
const COMMON_PASSWORD = "Welcome@123";
const CURRENT_DATE = new Date();
const CURRENT_YEAR = CURRENT_DATE.getFullYear();
const CURRENT_MONTH = CURRENT_DATE.getMonth() + 1;
const BALANCE_CYCLE_KEY = `${CURRENT_YEAR}`;

const roleDirectory: Record<RoleKey, "superadmin" | "admin" | "teamLeader" | "HR" | "employee"> = {
  superadmin: "superadmin",
  admin: "admin",
  manager: "teamLeader",
  hr: "HR",
  employee: "employee"
};

const departmentNames = [
  "Engineering",
  "Product",
  "Finance",
  "People Operations"
] as const;

const designationCatalog: Record<(typeof departmentNames)[number], string[]> = {
  Engineering: ["Engineering Manager", "Senior Software Engineer", "Software Engineer"],
  Product: ["Product Manager", "Business Analyst"],
  Finance: ["Finance Manager", "Accounts Executive"],
  "People Operations": ["People Operations Manager", "HR Executive"]
};

const people: PersonProfile[] = [
  {
    name: "Devansh Khanna",
    email: `devansh.khanna@${COMPANY_DOMAIN}`,
    username: "devansh.khanna",
    role: "superadmin",
    departmentName: "People Operations",
    designationName: "People Operations Manager",
    joiningDate: daysAgo(840)
  },
  {
    name: "Ritika Sharma",
    email: `ritika.sharma@${COMPANY_DOMAIN}`,
    username: "ritika.sharma",
    role: "admin",
    departmentName: "People Operations",
    designationName: "People Operations Manager",
    joiningDate: daysAgo(720)
  },
  {
    name: "Arjun Mehta",
    email: `arjun.mehta@${COMPANY_DOMAIN}`,
    username: "arjun.mehta",
    role: "manager",
    departmentName: "Engineering",
    designationName: "Engineering Manager",
    joiningDate: daysAgo(620)
  },
  {
    name: "Neha Iyer",
    email: `neha.iyer@${COMPANY_DOMAIN}`,
    username: "neha.iyer",
    role: "manager",
    departmentName: "Product",
    designationName: "Product Manager",
    joiningDate: daysAgo(580)
  },
  {
    name: "Karan Malhotra",
    email: `karan.malhotra@${COMPANY_DOMAIN}`,
    username: "karan.malhotra",
    role: "manager",
    departmentName: "Finance",
    designationName: "Finance Manager",
    joiningDate: daysAgo(540)
  },
  {
    name: "Aditi Rao",
    email: `aditi.rao@${COMPANY_DOMAIN}`,
    username: "aditi.rao",
    role: "employee",
    departmentName: "Engineering",
    designationName: "Senior Software Engineer",
    joiningDate: daysAgo(430),
    reportsTo: `arjun.mehta@${COMPANY_DOMAIN}`
  },
  {
    name: "Vikram Desai",
    email: `vikram.desai@${COMPANY_DOMAIN}`,
    username: "vikram.desai",
    role: "employee",
    departmentName: "Engineering",
    designationName: "Software Engineer",
    joiningDate: daysAgo(390),
    reportsTo: `arjun.mehta@${COMPANY_DOMAIN}`
  },
  {
    name: "Sneha Kulkarni",
    email: `sneha.kulkarni@${COMPANY_DOMAIN}`,
    username: "sneha.kulkarni",
    role: "employee",
    departmentName: "Engineering",
    designationName: "Software Engineer",
    joiningDate: daysAgo(350),
    reportsTo: `arjun.mehta@${COMPANY_DOMAIN}`
  },
  {
    name: "Rohan Bansal",
    email: `rohan.bansal@${COMPANY_DOMAIN}`,
    username: "rohan.bansal",
    role: "employee",
    departmentName: "Engineering",
    designationName: "Software Engineer",
    joiningDate: daysAgo(320),
    reportsTo: `arjun.mehta@${COMPANY_DOMAIN}`
  },
  {
    name: "Pooja Nair",
    email: `pooja.nair@${COMPANY_DOMAIN}`,
    username: "pooja.nair",
    role: "employee",
    departmentName: "Product",
    designationName: "Business Analyst",
    joiningDate: daysAgo(300),
    reportsTo: `neha.iyer@${COMPANY_DOMAIN}`
  },
  {
    name: "Siddharth Joshi",
    email: `siddharth.joshi@${COMPANY_DOMAIN}`,
    username: "siddharth.joshi",
    role: "employee",
    departmentName: "Product",
    designationName: "Business Analyst",
    joiningDate: daysAgo(280),
    reportsTo: `neha.iyer@${COMPANY_DOMAIN}`
  },
  {
    name: "Meera Krishnan",
    email: `meera.krishnan@${COMPANY_DOMAIN}`,
    username: "meera.krishnan",
    role: "employee",
    departmentName: "Product",
    designationName: "Business Analyst",
    joiningDate: daysAgo(250),
    reportsTo: `neha.iyer@${COMPANY_DOMAIN}`
  },
  {
    name: "Ananya Gupta",
    email: `ananya.gupta@${COMPANY_DOMAIN}`,
    username: "ananya.gupta",
    role: "employee",
    departmentName: "Finance",
    designationName: "Accounts Executive",
    joiningDate: daysAgo(240),
    reportsTo: `karan.malhotra@${COMPANY_DOMAIN}`
  },
  {
    name: "Rahul Chawla",
    email: `rahul.chawla@${COMPANY_DOMAIN}`,
    username: "rahul.chawla",
    role: "employee",
    departmentName: "Finance",
    designationName: "Accounts Executive",
    joiningDate: daysAgo(220),
    reportsTo: `karan.malhotra@${COMPANY_DOMAIN}`
  },
  {
    name: "Ishita Verma",
    email: `ishita.verma@${COMPANY_DOMAIN}`,
    username: "ishita.verma",
    role: "hr",
    departmentName: "People Operations",
    designationName: "HR Executive",
    joiningDate: daysAgo(210),
    reportsTo: `ritika.sharma@${COMPANY_DOMAIN}`
  },
  {
    name: "Tanya Kapoor",
    email: `tanya.kapoor@${COMPANY_DOMAIN}`,
    username: "tanya.kapoor",
    role: "employee",
    departmentName: "People Operations",
    designationName: "HR Executive",
    joiningDate: daysAgo(180),
    reportsTo: `ritika.sharma@${COMPANY_DOMAIN}`
  }
];

const projectPlans: ProjectPlan[] = [
  {
    name: "Project Netravault",
    description: "Unified employee document workspace for contracts, policy acknowledgements, and onboarding kits.",
    timeLimit: "20 weeks",
    startDate: daysAgo(150),
    status: "active",
    createdByEmail: `ritika.sharma@${COMPANY_DOMAIN}`,
    leaderEmail: `arjun.mehta@${COMPANY_DOMAIN}`,
    memberEmails: [
      `arjun.mehta@${COMPANY_DOMAIN}`,
      `aditi.rao@${COMPANY_DOMAIN}`,
      `vikram.desai@${COMPANY_DOMAIN}`,
      `sneha.kulkarni@${COMPANY_DOMAIN}`
    ]
  },
  {
    name: "Project Payroll Prism",
    description: "Quarterly payroll controls revamp covering approval routing, variance checks, and payout dashboards.",
    timeLimit: "14 weeks",
    startDate: daysAgo(125),
    status: "completed",
    createdByEmail: `karan.malhotra@${COMPANY_DOMAIN}`,
    leaderEmail: `karan.malhotra@${COMPANY_DOMAIN}`,
    memberEmails: [
      `karan.malhotra@${COMPANY_DOMAIN}`,
      `ananya.gupta@${COMPANY_DOMAIN}`,
      `rahul.chawla@${COMPANY_DOMAIN}`,
      `meera.krishnan@${COMPANY_DOMAIN}`
    ]
  },
  {
    name: "Project ClientPulse",
    description: "Internal delivery reporting hub for leadership with resource allocation, risks, and milestone visibility.",
    timeLimit: "18 weeks",
    startDate: daysAgo(90),
    status: "active",
    createdByEmail: `neha.iyer@${COMPANY_DOMAIN}`,
    leaderEmail: `neha.iyer@${COMPANY_DOMAIN}`,
    memberEmails: [
      `neha.iyer@${COMPANY_DOMAIN}`,
      `pooja.nair@${COMPANY_DOMAIN}`,
      `siddharth.joshi@${COMPANY_DOMAIN}`,
      `meera.krishnan@${COMPANY_DOMAIN}`,
      `rohan.bansal@${COMPANY_DOMAIN}`
    ]
  },
  {
    name: "Project AtlasBoard",
    description: "Cross-functional work planner for engineering and product teams with timeline and utilization insights.",
    timeLimit: "16 weeks",
    startDate: daysAgo(70),
    status: "active",
    createdByEmail: `ritika.sharma@${COMPANY_DOMAIN}`,
    leaderEmail: `arjun.mehta@${COMPANY_DOMAIN}`,
    memberEmails: [
      `arjun.mehta@${COMPANY_DOMAIN}`,
      `aditi.rao@${COMPANY_DOMAIN}`,
      `vikram.desai@${COMPANY_DOMAIN}`,
      `pooja.nair@${COMPANY_DOMAIN}`,
      `siddharth.joshi@${COMPANY_DOMAIN}`
    ]
  },
  {
    name: "Project PeopleBridge",
    description: "Employee engagement and leave communication portal aligned with approval workflows and policy updates.",
    timeLimit: "12 weeks",
    startDate: daysAgo(55),
    status: "pending",
    createdByEmail: `ritika.sharma@${COMPANY_DOMAIN}`,
    leaderEmail: `neha.iyer@${COMPANY_DOMAIN}`,
    memberEmails: [
      `neha.iyer@${COMPANY_DOMAIN}`,
      `ishita.verma@${COMPANY_DOMAIN}`,
      `tanya.kapoor@${COMPANY_DOMAIN}`,
      `pooja.nair@${COMPANY_DOMAIN}`
    ]
  },
  {
    name: "Project LedgerFlow",
    description: "Automated reimbursement audit and finance operations tracker for vendor settlements and employee claims.",
    timeLimit: "10 weeks",
    startDate: daysAgo(35),
    status: "active",
    createdByEmail: `karan.malhotra@${COMPANY_DOMAIN}`,
    leaderEmail: `karan.malhotra@${COMPANY_DOMAIN}`,
    memberEmails: [
      `karan.malhotra@${COMPANY_DOMAIN}`,
      `ananya.gupta@${COMPANY_DOMAIN}`,
      `rahul.chawla@${COMPANY_DOMAIN}`,
      `ishita.verma@${COMPANY_DOMAIN}`
    ]
  }
];

const taskPlans: TaskPlan[] = [
  {
    projectName: "Project Netravault",
    title: "Finalize onboarding document taxonomy",
    description: "Structure contract, policy, and induction folders for the new workspace migration.",
    createdByEmail: `ritika.sharma@${COMPANY_DOMAIN}`,
    assignedToEmail: `aditi.rao@${COMPANY_DOMAIN}`,
    status: "Completed",
    priority: "High",
    estimatedHours: 18,
    dueDate: daysAgo(112)
  },
  {
    projectName: "Project Netravault",
    title: "Implement employee file permission matrix",
    description: "Configure department-wise and role-wise access rules for sensitive document classes.",
    createdByEmail: `devansh.khanna@${COMPANY_DOMAIN}`,
    assignedToEmail: `vikram.desai@${COMPANY_DOMAIN}`,
    status: "In Review",
    priority: "Critical",
    estimatedHours: 24,
    dueDate: daysAgo(6)
  },
  {
    projectName: "Project Netravault",
    title: "Audit signed policy version visibility",
    description: "Verify that historical policy acknowledgements remain visible for compliance review.",
    createdByEmail: `ishita.verma@${COMPANY_DOMAIN}`,
    assignedToEmail: `sneha.kulkarni@${COMPANY_DOMAIN}`,
    status: "In Progress",
    priority: "Medium",
    estimatedHours: 14,
    dueDate: daysFromNow(8)
  },
  {
    projectName: "Project Netravault",
    title: "Prepare archive retention migration checklist",
    description: "Capture retention exceptions, migration checkpoints, and rollback notes.",
    createdByEmail: `arjun.mehta@${COMPANY_DOMAIN}`,
    assignedToEmail: `arjun.mehta@${COMPANY_DOMAIN}`,
    status: "Pending",
    priority: "High",
    estimatedHours: 10,
    dueDate: daysFromNow(15)
  },
  {
    projectName: "Project Payroll Prism",
    title: "Reconcile reimbursement approval queues",
    description: "Match pending approvals with finance policy thresholds and approver routing.",
    createdByEmail: `karan.malhotra@${COMPANY_DOMAIN}`,
    assignedToEmail: `ananya.gupta@${COMPANY_DOMAIN}`,
    status: "Completed",
    priority: "High",
    estimatedHours: 16,
    dueDate: daysAgo(84)
  },
  {
    projectName: "Project Payroll Prism",
    title: "Validate payroll variance exceptions",
    description: "Review salary variance cases generated during quarterly reconciliation.",
    createdByEmail: `devansh.khanna@${COMPANY_DOMAIN}`,
    assignedToEmail: `rahul.chawla@${COMPANY_DOMAIN}`,
    status: "Completed",
    priority: "Critical",
    estimatedHours: 20,
    dueDate: daysAgo(78)
  },
  {
    projectName: "Project Payroll Prism",
    title: "Document payout control handoff",
    description: "Prepare operations notes for recurring payroll control execution.",
    createdByEmail: `ritika.sharma@${COMPANY_DOMAIN}`,
    assignedToEmail: `karan.malhotra@${COMPANY_DOMAIN}`,
    status: "In Review",
    priority: "Medium",
    estimatedHours: 11,
    dueDate: daysAgo(14)
  },
  {
    projectName: "Project Payroll Prism",
    title: "Review payroll dashboard sign-off pack",
    description: "Compile final metrics deck for finance and leadership approval.",
    createdByEmail: `ishita.verma@${COMPANY_DOMAIN}`,
    assignedToEmail: `meera.krishnan@${COMPANY_DOMAIN}`,
    status: "Pending",
    priority: "Medium",
    estimatedHours: 9,
    dueDate: daysFromNow(10)
  },
  {
    projectName: "Project ClientPulse",
    title: "Create utilization dashboard wireframes",
    description: "Draft dashboard sections for resource allocation, risks, and delivery signals.",
    createdByEmail: `neha.iyer@${COMPANY_DOMAIN}`,
    assignedToEmail: `pooja.nair@${COMPANY_DOMAIN}`,
    status: "Completed",
    priority: "High",
    estimatedHours: 12,
    dueDate: daysAgo(58)
  },
  {
    projectName: "Project ClientPulse",
    title: "Build milestone health summary APIs",
    description: "Expose backend-ready summaries for project milestone confidence and delays.",
    createdByEmail: `devansh.khanna@${COMPANY_DOMAIN}`,
    assignedToEmail: `rohan.bansal@${COMPANY_DOMAIN}`,
    status: "In Progress",
    priority: "Critical",
    estimatedHours: 26,
    dueDate: daysFromNow(11)
  },
  {
    projectName: "Project ClientPulse",
    title: "Map account escalation workflow",
    description: "Define escalation categories, SLAs, and owner mapping for executive reporting.",
    createdByEmail: `ritika.sharma@${COMPANY_DOMAIN}`,
    assignedToEmail: `siddharth.joshi@${COMPANY_DOMAIN}`,
    status: "In Review",
    priority: "High",
    estimatedHours: 15,
    dueDate: daysFromNow(5)
  },
  {
    projectName: "Project ClientPulse",
    title: "Align delivery reporting glossary",
    description: "Standardize metric naming across business reviews and reporting screens.",
    createdByEmail: `ishita.verma@${COMPANY_DOMAIN}`,
    assignedToEmail: `meera.krishnan@${COMPANY_DOMAIN}`,
    status: "Pending",
    priority: "Low",
    estimatedHours: 8,
    dueDate: daysFromNow(16)
  },
  {
    projectName: "Project AtlasBoard",
    title: "Design cross-team sprint capacity model",
    description: "Estimate capacity inputs needed for engineering and product planning.",
    createdByEmail: `ritika.sharma@${COMPANY_DOMAIN}`,
    assignedToEmail: `aditi.rao@${COMPANY_DOMAIN}`,
    status: "Completed",
    priority: "High",
    estimatedHours: 13,
    dueDate: daysAgo(33)
  },
  {
    projectName: "Project AtlasBoard",
    title: "Implement planning board filters",
    description: "Add project, owner, and department filters for large planning boards.",
    createdByEmail: `arjun.mehta@${COMPANY_DOMAIN}`,
    assignedToEmail: `vikram.desai@${COMPANY_DOMAIN}`,
    status: "In Progress",
    priority: "High",
    estimatedHours: 21,
    dueDate: daysFromNow(7)
  },
  {
    projectName: "Project AtlasBoard",
    title: "Write product requirement traceability notes",
    description: "Link product requests with engineering delivery units and milestone targets.",
    createdByEmail: `neha.iyer@${COMPANY_DOMAIN}`,
    assignedToEmail: `pooja.nair@${COMPANY_DOMAIN}`,
    status: "In Review",
    priority: "Medium",
    estimatedHours: 10,
    dueDate: daysFromNow(4)
  },
  {
    projectName: "Project AtlasBoard",
    title: "Validate team allocation export",
    description: "Check CSV exports for staffing views and planner audit usage.",
    createdByEmail: `devansh.khanna@${COMPANY_DOMAIN}`,
    assignedToEmail: `siddharth.joshi@${COMPANY_DOMAIN}`,
    status: "Pending",
    priority: "Medium",
    estimatedHours: 9,
    dueDate: daysFromNow(13)
  },
  {
    projectName: "Project PeopleBridge",
    title: "Draft leave announcement content calendar",
    description: "Plan leave-policy communication cadence for monthly employee updates.",
    createdByEmail: `ishita.verma@${COMPANY_DOMAIN}`,
    assignedToEmail: `tanya.kapoor@${COMPANY_DOMAIN}`,
    status: "Pending",
    priority: "Medium",
    estimatedHours: 7,
    dueDate: daysFromNow(12)
  },
  {
    projectName: "Project PeopleBridge",
    title: "Model employee engagement pulse survey",
    description: "Prepare survey structure, response themes, and visibility rules.",
    createdByEmail: `ritika.sharma@${COMPANY_DOMAIN}`,
    assignedToEmail: `pooja.nair@${COMPANY_DOMAIN}`,
    status: "In Progress",
    priority: "High",
    estimatedHours: 12,
    dueDate: daysFromNow(9)
  },
  {
    projectName: "Project PeopleBridge",
    title: "Create policy acknowledgement reminder flow",
    description: "Define reminder timing and escalation states for overdue acknowledgements.",
    createdByEmail: `devansh.khanna@${COMPANY_DOMAIN}`,
    assignedToEmail: `tanya.kapoor@${COMPANY_DOMAIN}`,
    status: "In Review",
    priority: "High",
    estimatedHours: 11,
    dueDate: daysFromNow(3)
  },
  {
    projectName: "Project PeopleBridge",
    title: "Prepare launch FAQ for managers",
    description: "Compile FAQs covering leave routing, notifications, and employee visibility.",
    createdByEmail: `neha.iyer@${COMPANY_DOMAIN}`,
    assignedToEmail: `neha.iyer@${COMPANY_DOMAIN}`,
    status: "Pending",
    priority: "Low",
    estimatedHours: 6,
    dueDate: daysFromNow(18)
  },
  {
    projectName: "Project LedgerFlow",
    title: "Configure vendor settlement tracker fields",
    description: "Finalize finance tracker columns for vendors, claims, and settlement aging.",
    createdByEmail: `karan.malhotra@${COMPANY_DOMAIN}`,
    assignedToEmail: `ananya.gupta@${COMPANY_DOMAIN}`,
    status: "In Progress",
    priority: "High",
    estimatedHours: 14,
    dueDate: daysFromNow(6)
  },
  {
    projectName: "Project LedgerFlow",
    title: "Verify claims audit evidence checklist",
    description: "Ensure reimbursement and settlement audits include mandatory proof categories.",
    createdByEmail: `ritika.sharma@${COMPANY_DOMAIN}`,
    assignedToEmail: `rahul.chawla@${COMPANY_DOMAIN}`,
    status: "Completed",
    priority: "Critical",
    estimatedHours: 17,
    dueDate: daysAgo(9)
  },
  {
    projectName: "Project LedgerFlow",
    title: "Review policy exception handling",
    description: "Capture exception approval paths for non-standard finance requests.",
    createdByEmail: `ishita.verma@${COMPANY_DOMAIN}`,
    assignedToEmail: `karan.malhotra@${COMPANY_DOMAIN}`,
    status: "In Review",
    priority: "Medium",
    estimatedHours: 9,
    dueDate: daysFromNow(2)
  },
  {
    projectName: "Project LedgerFlow",
    title: "Prepare reimbursement cycle dashboard notes",
    description: "Summarize pending, approved, and overdue cycle metrics for leadership review.",
    createdByEmail: `devansh.khanna@${COMPANY_DOMAIN}`,
    assignedToEmail: `rahul.chawla@${COMPANY_DOMAIN}`,
    status: "Pending",
    priority: "Medium",
    estimatedHours: 8,
    dueDate: daysFromNow(14)
  }
];

async function main() {
  await connectDB();

  const hashedPassword = await bcrypt.hash(COMMON_PASSWORD, 10);

  const departments = await upsertDepartments();
  const designations = await upsertDesignations(departments);
  const users = await upsertUsers({ departments, designations, hashedPassword });
  const leaveTypes = await upsertLeaveTypes(users);

  await upsertLeaveBalances(users, leaveTypes);
  const projects = await upsertProjects(users);
  await rebuildTasks(projects, users);
  await rebuildAttendance(users);
  await rebuildLeaves(users, leaveTypes);

  console.log("EMS data initialization completed successfully.");
  console.log(`Default password for created users: ${COMMON_PASSWORD}`);

  await mongoose.disconnect();
}

async function upsertDepartments() {
  const departmentMap = new Map<string, InstanceType<typeof Department>>();

  for (const departmentName of departmentNames) {
    const department = await Department.findOneAndUpdate(
      { name: departmentName },
      { $set: { name: departmentName, status: "Active", isDeleted: false } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    departmentMap.set(departmentName, department);
  }

  return departmentMap;
}

async function upsertDesignations(departments: Map<string, InstanceType<typeof Department>>) {
  const designationMap = new Map<string, InstanceType<typeof Designation>>();

  for (const [departmentName, designationNames] of Object.entries(designationCatalog)) {
    const department = departments.get(departmentName);

    if (!department) {
      throw new Error(`Department not found for designation group: ${departmentName}`);
    }

    for (const designationName of designationNames) {
      const designation = await Designation.findOneAndUpdate(
        { name: designationName, department: department._id },
        {
          $set: {
            name: designationName,
            department: department._id,
            status: "Active",
            isDeleted: false
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      designationMap.set(`${departmentName}:${designationName}`, designation);
    }
  }

  return designationMap;
}

async function upsertUsers(params: {
  departments: Map<string, InstanceType<typeof Department>>;
  designations: Map<string, InstanceType<typeof Designation>>;
  hashedPassword: string;
}) {
  const userMap = new Map<string, InstanceType<typeof User>>();

  for (const person of people) {
    const department = params.departments.get(person.departmentName);
    const designation = params.designations.get(`${person.departmentName}:${person.designationName}`);

    if (!department || !designation) {
      throw new Error(`Missing relationship for ${person.email}`);
    }

    const existing = await User.findOne({ email: person.email });
    const reportManager = person.reportsTo ? userMap.get(person.reportsTo) ?? (await User.findOne({ email: person.reportsTo })) : null;

    const payload = {
      name: person.name,
      email: person.email,
      username: person.username,
      password: params.hashedPassword,
      role: roleDirectory[person.role],
      department: department._id,
      designation: designation._id,
      joiningDate: person.joiningDate,
      teamLeaderId: person.role === "employee" ? reportManager?._id ?? null : null,
      isActive: true,
      status: "Active" as const,
      isDeleted: false,
      resetPasswordToken: null,
      resetPasswordExpires: null
    };

    const user = existing
      ? await User.findByIdAndUpdate(existing._id, { $set: payload }, { new: true })
      : await User.create(payload);

    if (!user) {
      throw new Error(`User update failed for ${person.email}`);
    }

    userMap.set(person.email, user);
  }

  return userMap;
}

async function upsertLeaveTypes(users: Map<string, InstanceType<typeof User>>) {
  const admin = users.get(`ritika.sharma@${COMPANY_DOMAIN}`);

  if (!admin) {
    throw new Error("Admin account was not created.");
  }

  const definitions = [
    {
      name: "Sick Leave",
      code: "SL",
      color: "#dc2626",
      description: "Leave available for personal illness, medical consultations, or recovery periods.",
      totalAllocation: 12,
      maxDaysPerRequest: 5,
      allowPastDates: true,
      requiresAttachment: true,
      approvalWorkflowType: "two_level" as const,
      approvalFlowSteps: [
        { level: 1, role: "teamLeader" as const },
        { level: 2, role: "admin" as const }
      ]
    },
    {
      name: "Casual Leave",
      code: "CL",
      color: "#0f766e",
      description: "Short planned personal time off for appointments, family commitments, or urgent errands.",
      totalAllocation: 10,
      maxDaysPerRequest: 3,
      allowPastDates: false,
      requiresAttachment: false,
      approvalWorkflowType: "two_level" as const,
      approvalFlowSteps: [
        { level: 1, role: "teamLeader" as const },
        { level: 2, role: "admin" as const }
      ]
    },
    {
      name: "Paid Leave",
      code: "PL",
      color: "#2563eb",
      description: "Planned annual leave for vacations, travel, or extended personal time.",
      totalAllocation: 18,
      maxDaysPerRequest: 10,
      allowPastDates: false,
      requiresAttachment: false,
      approvalWorkflowType: "two_level" as const,
      approvalFlowSteps: [
        { level: 1, role: "teamLeader" as const },
        { level: 2, role: "admin" as const }
      ]
    }
  ];

  const leaveTypeMap = new Map<string, InstanceType<typeof LeaveType>>();

  for (const definition of definitions) {
    const leaveType = await LeaveType.findOneAndUpdate(
      { code: definition.code, isDeleted: false },
      {
        $set: {
          ...definition,
          allocationPeriod: "yearly",
          carryForwardEnabled: true,
          maxCarryForwardLimit: 5,
          accrualEnabled: false,
          accrualAmount: 0,
          accrualFrequency: "monthly",
          minNoticeDays: definition.code === "PL" ? 7 : 0,
          status: "Active",
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          createdBy: admin._id,
          updatedBy: admin._id
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    leaveTypeMap.set(definition.code, leaveType);
  }

  return leaveTypeMap;
}

async function upsertLeaveBalances(
  users: Map<string, InstanceType<typeof User>>,
  leaveTypes: Map<string, InstanceType<typeof LeaveType>>
) {
  const managedUsers = Array.from(users.values()).filter((user) =>
    ["employee", "teamLeader", "HR"].includes(user.role)
  );

  for (const user of managedUsers) {
    for (const leaveType of leaveTypes.values()) {
      const used = resolveUsedDays(user.email, leaveType.code);
      const pending = resolvePendingDays(user.email, leaveType.code);

      await LeaveBalance.findOneAndUpdate(
        {
          employeeId: user._id,
          leaveTypeId: leaveType._id,
          cycleKey: BALANCE_CYCLE_KEY
        },
        {
          $set: {
            employeeId: user._id,
            leaveTypeId: leaveType._id,
            year: CURRENT_YEAR,
            month: null,
            cycleKey: BALANCE_CYCLE_KEY,
            totalAllocated: leaveType.totalAllocation,
            accrued: 0,
            carriedForward: leaveType.code === "PL" ? 2 : 0,
            used,
            pending,
            processedAccrualPeriods: [],
            carryForwardSourceCycleKey: leaveType.code === "PL" ? `${CURRENT_YEAR - 1}` : null,
            lastAccrualRunAt: null,
            lastCarryForwardRunAt: daysAgo(30)
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
  }
}

async function upsertProjects(users: Map<string, InstanceType<typeof User>>) {
  const projectMap = new Map<string, InstanceType<typeof Project>>();

  for (const plan of projectPlans) {
    const creator = users.get(plan.createdByEmail);
    const leader = users.get(plan.leaderEmail);
    const members = plan.memberEmails.map((email) => {
      const user = users.get(email);

      if (!user) {
        throw new Error(`Project member not found for ${email}`);
      }

      return user._id;
    });

    if (!creator || !leader) {
      throw new Error(`Project ownership missing for ${plan.name}`);
    }

    const project = await Project.findOneAndUpdate(
      { name: plan.name, isDeleted: false },
      {
        $set: {
          name: plan.name,
          description: plan.description,
          timeLimit: plan.timeLimit,
          startDate: plan.startDate,
          status: plan.status,
          projectLeader: leader._id,
          members,
          employees: members,
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          createdBy: creator._id
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    projectMap.set(plan.name, project);
  }

  return projectMap;
}

async function rebuildTasks(
  projects: Map<string, InstanceType<typeof Project>>,
  users: Map<string, InstanceType<typeof User>>
) {
  const projectIds = Array.from(projects.values()).map((project) => project._id);
  await Task.deleteMany({ projectId: { $in: projectIds } });

  for (const plan of taskPlans) {
    const project = projects.get(plan.projectName);
    const creator = users.get(plan.createdByEmail);
    const assignee = users.get(plan.assignedToEmail);

    if (!project || !creator || !assignee) {
      throw new Error(`Task relationship missing for ${plan.title}`);
    }

    await Task.create({
      projectId: project._id,
      title: plan.title,
      description: plan.description,
      createdBy: creator._id,
      assignedBy: creator._id,
      assignedTo: assignee._id,
      status: plan.status,
      priority: plan.priority,
      dueDate: plan.dueDate,
      estimatedHours: plan.estimatedHours,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null
    });
  }
}

async function rebuildAttendance(users: Map<string, InstanceType<typeof User>>) {
  const employeeList = Array.from(users.values()).filter((user) =>
    user.role === "employee" || user.role === "HR"
  );
  const workingDays = getRecentWorkingDays(4);

  for (const employee of employeeList) {
    for (let index = 0; index < workingDays.length; index += 1) {
      const day = workingDays[index];
      const statusMode = (employee.name.length + index) % 6;

      const status =
        statusMode === 0 ? "ABSENT" : statusMode === 1 ? "PRESENT" : "PRESENT";
      const lateMinutes = statusMode === 1 ? 18 : statusMode === 2 ? 9 : 0;
      const totalWorkMinutes = status === "ABSENT" ? 0 : lateMinutes > 0 ? 498 : 528;
      const totalBreakMinutes = status === "ABSENT" ? 0 : 52;
      const firstIn = status === "ABSENT" ? null : atTime(day, 9, lateMinutes > 0 ? 28 : 7);
      const lastOut = status === "ABSENT" ? null : atTime(day, 18, lateMinutes > 0 ? 6 : 1);

      await AttendanceDailySummary.findOneAndUpdate(
        { employeeId: employee._id, dateKey: formatDateKey(day) },
        {
          $set: {
            employeeId: employee._id,
            date: stripTime(day),
            dateKey: formatDateKey(day),
            year: day.getFullYear(),
            month: day.getMonth() + 1,
            totalWorkMinutes,
            totalBreakMinutes,
            firstIn,
            lastOut,
            status,
            lateMinutes,
            isHalfDayLeave: false,
            leaveId: null,
            holidayId: null,
            weeklyOffApplied: false,
            remarks: lateMinutes > 0 ? "Late arrival recorded with normal checkout." : "",
            missedPunch: false,
            punchCount: status === "ABSENT" ? 0 : 2
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
  }
}

async function rebuildLeaves(
  users: Map<string, InstanceType<typeof User>>,
  leaveTypes: Map<string, InstanceType<typeof LeaveType>>
) {
  const managedUserIds = Array.from(users.values()).map((user) => user._id);

  await LeaveRequest.deleteMany({ employeeId: { $in: managedUserIds } });

  const admin = users.get(`ritika.sharma@${COMPANY_DOMAIN}`);
  const sickLeave = leaveTypes.get("SL");
  const casualLeave = leaveTypes.get("CL");
  const paidLeave = leaveTypes.get("PL");

  if (!admin || !sickLeave || !casualLeave || !paidLeave) {
    throw new Error("Required leave records are missing.");
  }

  const leaveEntries = [
    buildLeaveEntry({
      employee: users.get(`aditi.rao@${COMPANY_DOMAIN}`),
      approver: users.get(`arjun.mehta@${COMPANY_DOMAIN}`),
      finalApprover: admin,
      leaveType: casualLeave,
      fromDate: daysAgo(52),
      toDate: daysAgo(51),
      totalDays: 2,
      reason: "Family function travel to Pune.",
      status: "Approved"
    }),
    buildLeaveEntry({
      employee: users.get(`vikram.desai@${COMPANY_DOMAIN}`),
      approver: users.get(`arjun.mehta@${COMPANY_DOMAIN}`),
      finalApprover: admin,
      leaveType: sickLeave,
      fromDate: daysAgo(34),
      toDate: daysAgo(34),
      totalDays: 1,
      reason: "Medical consultation for viral fever symptoms.",
      status: "Approved"
    }),
    buildLeaveEntry({
      employee: users.get(`sneha.kulkarni@${COMPANY_DOMAIN}`),
      approver: users.get(`arjun.mehta@${COMPANY_DOMAIN}`),
      finalApprover: admin,
      leaveType: paidLeave,
      fromDate: daysAgo(12),
      toDate: daysAgo(10),
      totalDays: 3,
      reason: "Planned short vacation with family.",
      status: "Level 1 Approved"
    }),
    buildLeaveEntry({
      employee: users.get(`rohan.bansal@${COMPANY_DOMAIN}`),
      approver: users.get(`arjun.mehta@${COMPANY_DOMAIN}`),
      finalApprover: admin,
      leaveType: casualLeave,
      fromDate: daysAgo(18),
      toDate: daysAgo(18),
      totalDays: 1,
      reason: "Home registration appointment.",
      status: "Rejected",
      rejectionReason: "Quarter-end release support required on requested date."
    }),
    buildLeaveEntry({
      employee: users.get(`pooja.nair@${COMPANY_DOMAIN}`),
      approver: users.get(`neha.iyer@${COMPANY_DOMAIN}`),
      finalApprover: admin,
      leaveType: casualLeave,
      fromDate: daysFromNow(9),
      toDate: daysFromNow(10),
      totalDays: 2,
      reason: "Family visit to Kochi.",
      status: "Pending"
    }),
    buildLeaveEntry({
      employee: users.get(`siddharth.joshi@${COMPANY_DOMAIN}`),
      approver: users.get(`neha.iyer@${COMPANY_DOMAIN}`),
      finalApprover: admin,
      leaveType: paidLeave,
      fromDate: daysAgo(64),
      toDate: daysAgo(60),
      totalDays: 5,
      reason: "Annual leave for wedding ceremonies at Jaipur.",
      status: "Approved"
    }),
    buildLeaveEntry({
      employee: users.get(`meera.krishnan@${COMPANY_DOMAIN}`),
      approver: users.get(`neha.iyer@${COMPANY_DOMAIN}`),
      finalApprover: admin,
      leaveType: sickLeave,
      fromDate: daysAgo(7),
      toDate: daysAgo(7),
      totalDays: 1,
      reason: "Recovery day after a migraine episode.",
      status: "Approved"
    }),
    buildLeaveEntry({
      employee: users.get(`ananya.gupta@${COMPANY_DOMAIN}`),
      approver: users.get(`karan.malhotra@${COMPANY_DOMAIN}`),
      finalApprover: admin,
      leaveType: paidLeave,
      fromDate: daysFromNow(18),
      toDate: daysFromNow(20),
      totalDays: 3,
      reason: "Pre-booked family trip to Udaipur.",
      status: "Level 1 Approved"
    }),
    buildLeaveEntry({
      employee: users.get(`rahul.chawla@${COMPANY_DOMAIN}`),
      approver: users.get(`karan.malhotra@${COMPANY_DOMAIN}`),
      finalApprover: admin,
      leaveType: casualLeave,
      fromDate: daysAgo(27),
      toDate: daysAgo(26),
      totalDays: 2,
      reason: "Personal documentation work and bank formalities.",
      status: "Approved"
    }),
    buildLeaveEntry({
      employee: users.get(`ishita.verma@${COMPANY_DOMAIN}`),
      approver: admin,
      finalApprover: admin,
      leaveType: sickLeave,
      fromDate: daysAgo(41),
      toDate: daysAgo(40),
      totalDays: 2,
      reason: "Recovery period after a dental procedure.",
      status: "Approved",
      approvalFlowSteps: [{ level: 1, role: "admin" as const }]
    }),
    buildLeaveEntry({
      employee: users.get(`tanya.kapoor@${COMPANY_DOMAIN}`),
      approver: admin,
      finalApprover: admin,
      leaveType: casualLeave,
      fromDate: daysFromNow(6),
      toDate: daysFromNow(6),
      totalDays: 1,
      reason: "Family medical appointment support.",
      status: "Pending",
      approvalFlowSteps: [{ level: 1, role: "admin" as const }]
    }),
    buildLeaveEntry({
      employee: users.get(`aditi.rao@${COMPANY_DOMAIN}`),
      approver: users.get(`arjun.mehta@${COMPANY_DOMAIN}`),
      finalApprover: admin,
      leaveType: sickLeave,
      fromDate: daysAgo(96),
      toDate: daysAgo(95),
      totalDays: 2,
      reason: "Doctor-advised rest for seasonal infection.",
      status: "Approved"
    })
  ];

  for (const entry of leaveEntries) {
    await LeaveRequest.create(entry);
  }
}

function buildLeaveEntry(params: {
  employee: InstanceType<typeof User> | undefined;
  approver: InstanceType<typeof User> | undefined;
  finalApprover: InstanceType<typeof User>;
  leaveType: InstanceType<typeof LeaveType>;
  fromDate: Date;
  toDate: Date;
  totalDays: number;
  reason: string;
  status: "Pending" | "Level 1 Approved" | "Approved" | "Rejected";
  rejectionReason?: string;
  approvalFlowSteps?: Array<{ level: number; role: "admin" | "teamLeader" }>;
}) {
  if (!params.employee || !params.approver) {
    throw new Error("Leave entry cannot be created because a related user is missing.");
  }

  const steps =
    params.approvalFlowSteps ??
    [
      { level: 1, role: "teamLeader" as const },
      { level: 2, role: "admin" as const }
    ];

  const approvalHistory: Array<{
    level: number;
    action: "Submitted" | "Approved" | "Rejected" | "Cancelled";
    by: mongoose.Types.ObjectId;
    role: string;
    remarks: string;
    actedAt: Date;
  }> = [
    {
      level: 0,
      action: "Submitted" as const,
      by: params.employee._id,
      role: params.employee.role,
      remarks: "Request submitted from the employee portal.",
      actedAt: daysBefore(params.fromDate, 12)
    }
  ];

  if (params.status === "Level 1 Approved" || params.status === "Approved" || params.status === "Rejected") {
    approvalHistory.push({
      level: 1,
      action: params.status === "Rejected" ? "Rejected" : "Approved",
      by: params.approver._id,
      role: params.approver.role,
      remarks:
        params.status === "Rejected"
          ? params.rejectionReason ?? "Manager rejected the request."
          : "Manager reviewed capacity and approved the request.",
      actedAt: daysBefore(params.fromDate, 8)
    });
  }

  if (params.status === "Approved") {
    approvalHistory.push({
      level: steps.length,
      action: "Approved",
      by: params.finalApprover._id,
      role: params.finalApprover.role,
      remarks: "Administrative approval completed.",
      actedAt: daysBefore(params.fromDate, 5)
    });
  }

  return {
    employeeId: params.employee._id,
    leaveTypeId: params.leaveType._id,
    leaveTypeSnapshot: {
      name: params.leaveType.name,
      code: params.leaveType.code,
      color: params.leaveType.color
    },
    fromDate: stripTime(params.fromDate),
    toDate: stripTime(params.toDate),
    dayUnit: "FULL" as const,
    totalDays: params.totalDays,
    reason: params.reason,
    attachment: null,
    status: params.status,
    currentApprovalLevel:
      params.status === "Pending" ? 0 : params.status === "Level 1 Approved" ? 1 : steps.length,
    balanceCycleKey: BALANCE_CYCLE_KEY,
    approvalWorkflowType: steps.length > 1 ? "two_level" : "single_level",
    approvalFlowSteps: steps,
    approvalHistory,
    cancelledAt: null,
    cancelledBy: null,
    rejectionReason: params.status === "Rejected" ? params.rejectionReason ?? "Request rejected." : "",
    createdAt: daysBefore(params.fromDate, 12),
    updatedAt:
      params.status === "Pending" ? daysBefore(params.fromDate, 12) : daysBefore(params.fromDate, 5)
  };
}

function resolveUsedDays(email: string, leaveCode: string) {
  const key = `${email}:${leaveCode}`;
  const usageTable: Record<string, number> = {
    [`aditi.rao@${COMPANY_DOMAIN}:CL`]: 2,
    [`aditi.rao@${COMPANY_DOMAIN}:SL`]: 2,
    [`vikram.desai@${COMPANY_DOMAIN}:SL`]: 1,
    [`siddharth.joshi@${COMPANY_DOMAIN}:PL`]: 5,
    [`meera.krishnan@${COMPANY_DOMAIN}:SL`]: 1,
    [`rahul.chawla@${COMPANY_DOMAIN}:CL`]: 2,
    [`ishita.verma@${COMPANY_DOMAIN}:SL`]: 2
  };

  return usageTable[key] ?? 0;
}

function resolvePendingDays(email: string, leaveCode: string) {
  const key = `${email}:${leaveCode}`;
  const pendingTable: Record<string, number> = {
    [`sneha.kulkarni@${COMPANY_DOMAIN}:PL`]: 3,
    [`pooja.nair@${COMPANY_DOMAIN}:CL`]: 2,
    [`ananya.gupta@${COMPANY_DOMAIN}:PL`]: 3,
    [`tanya.kapoor@${COMPANY_DOMAIN}:CL`]: 1
  };

  return pendingTable[key] ?? 0;
}

function getRecentWorkingDays(count: number) {
  const days: Date[] = [];
  const cursor = stripTime(daysAgo(1));

  while (days.length < count) {
    const day = cursor.getDay();

    if (day !== 0 && day !== 6) {
      days.unshift(new Date(cursor));
    }

    cursor.setDate(cursor.getDate() - 1);
  }

  return days;
}

function daysAgo(value: number) {
  const date = new Date(CURRENT_DATE);
  date.setDate(date.getDate() - value);
  return stripTime(date);
}

function daysFromNow(value: number) {
  const date = new Date(CURRENT_DATE);
  date.setDate(date.getDate() + value);
  return stripTime(date);
}

function daysBefore(baseDate: Date, value: number) {
  const date = new Date(baseDate);
  date.setDate(date.getDate() - value);
  return date;
}

function atTime(baseDate: Date, hours: number, minutes: number) {
  const date = new Date(baseDate);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function stripTime(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

main().catch(async (error) => {
  console.error("EMS data initialization failed:", error);
  await mongoose.disconnect();
  process.exit(1);
});
