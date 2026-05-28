export type Role = "lead" | "member";

export type ReportStatus = "draft" | "submitted" | "returned" | "approved";

export type ReportTemplate = {
  mode: "free" | "structured";
  sections: string[];
  instructions: string;
};

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export type Team = {
  id: string;
  name: string;
  joinCode: string;
  deadlineDay: string;
  deadlineTime: string;
  template: ReportTemplate;
  leadId: string;
  members: TeamMember[];
};

export type WeeklyReport = {
  id: string;
  employeeId: string;
  employeeName: string;
  week: string;
  weekStart?: string;
  status: ReportStatus;
  submittedAt?: string;
  returnedComment?: string;
  sections: Record<string, string>;
};

export type Summary = {
  highlights: string[];
  blockers: string[];
  nextSteps: string[];
  risks: string[];
  raw: string;
};
