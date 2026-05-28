import type { User } from "@supabase/supabase-js";
import { currentWeekStart } from "./dates";
import { supabase } from "./supabase";
import type { ReportStatus, Role, Summary, Team, TeamMember, WeeklyReport } from "../types";

type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
};

type TeamRow = {
  id: string;
  name: string;
  lead_id: string;
  join_code: string;
  deadline_day: string;
  deadline_time: string;
  template_mode: "free" | "structured";
  template_sections: string[];
  template_instructions: string;
};

type TeamMemberRow = {
  role: Role;
  profiles: ProfileRow | ProfileRow[] | null;
};

type ReportRow = {
  id: string;
  employee_id: string;
  week_start: string;
  week_label: string;
  status: ReportStatus;
  submitted_at: string | null;
  returned_comment: string | null;
  sections: Record<string, string>;
  profiles: ProfileRow | ProfileRow[] | null;
};

type SummaryRow = {
  content: Summary | null;
  raw_text: string | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function displayName(profile: ProfileRow | null, fallback = "Без имени") {
  return profile?.full_name?.trim() || profile?.email || fallback;
}

function mapTeam(row: TeamRow, members: TeamMember[]): Team {
  return {
    id: row.id,
    name: row.name,
    leadId: row.lead_id,
    joinCode: row.join_code,
    deadlineDay: row.deadline_day,
    deadlineTime: row.deadline_time.slice(0, 5),
    template: {
      mode: row.template_mode,
      sections: row.template_sections,
      instructions: row.template_instructions,
    },
    members,
  };
}

function mapReport(row: ReportRow): WeeklyReport {
  const profile = one(row.profiles);
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: displayName(profile),
    week: row.week_label,
    weekStart: row.week_start,
    status: row.status,
    submittedAt: row.submitted_at
      ? new Intl.DateTimeFormat("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(row.submitted_at))
      : undefined,
    returnedComment: row.returned_comment ?? undefined,
    sections: row.sections ?? {},
  };
}

export async function ensureProfile(user: User, fullName?: string) {
  if (!supabase) throw new Error("Supabase is not configured");
  const email = user.email ?? "";
  const name =
    fullName?.trim() ||
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name as string | undefined) ||
    email;

  const { data, error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, email, full_name: name }, { onConflict: "id" })
    .select("id,email,full_name")
    .single();

  if (error) throw error;
  return data as ProfileRow;
}

export async function loadTeams(userId: string) {
  if (!supabase) throw new Error("Supabase is not configured");
  const client = supabase;

  const { data: memberships, error: membershipError } = await client
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId);

  if (membershipError) throw membershipError;

  const { data: ledTeams, error: ledTeamsError } = await client
    .from("teams")
    .select("id")
    .eq("lead_id", userId);

  if (ledTeamsError) throw ledTeamsError;

  const ids = Array.from(
    new Set([
      ...(memberships ?? []).map((item) => item.team_id as string),
      ...(ledTeams ?? []).map((item) => item.id as string),
    ])
  );
  if (ids.length === 0) return [];

  const { data: teamRows, error: teamError } = await client
    .from("teams")
    .select(
      "id,name,lead_id,join_code,deadline_day,deadline_time,template_mode,template_sections,template_instructions"
    )
    .in("id", ids)
    .order("created_at", { ascending: true });

  if (teamError) throw teamError;

  const teams = await Promise.all(
    ((teamRows ?? []) as TeamRow[]).map(async (teamRow) => {
      const { data: memberRows, error: memberError } = await client
        .from("team_members")
        .select("role, profiles(id,email,full_name)")
        .eq("team_id", teamRow.id);

      if (memberError) throw memberError;
      const members = ((memberRows ?? []) as TeamMemberRow[]).map((member) => {
        const profile = one(member.profiles);
        return {
          id: profile?.id ?? "",
          email: profile?.email ?? "",
          name: displayName(profile),
          role: member.role,
        };
      });
      return mapTeam(teamRow, members);
    })
  );

  return teams;
}

export async function createTeam(input: {
  leadId: string;
  name: string;
  deadlineDay: string;
  deadlineTime: string;
  sections: string[];
  instructions: string;
}) {
  if (!supabase) throw new Error("Supabase is not configured");
  const joinCode = crypto.randomUUID().slice(0, 6).replace(/-/g, "").toUpperCase();

  const { data: team, error: teamError } = await supabase
    .from("teams")
    .insert({
      lead_id: input.leadId,
      name: input.name,
      join_code: joinCode,
      deadline_day: input.deadlineDay,
      deadline_time: input.deadlineTime,
      template_mode: "structured",
      template_sections: input.sections,
      template_instructions: input.instructions,
    })
    .select()
    .single();

  if (teamError) throw teamError;

  const { error: memberError } = await supabase.from("team_members").insert({
    team_id: team.id,
    user_id: input.leadId,
    role: "lead",
  });

  if (memberError) throw memberError;
  return team as TeamRow;
}

export async function joinTeamByCode(userId: string, code: string) {
  if (!supabase) throw new Error("Supabase is not configured");
  const cleanCode = code.trim().toUpperCase();
  void userId;
  const { error } = await supabase.rpc("join_team_by_code", { input_code: cleanCode });
  if (error) throw error;
}

export async function saveTeam(team: Team) {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase
    .from("teams")
    .update({
      name: team.name,
      deadline_day: team.deadlineDay,
      deadline_time: team.deadlineTime,
      template_mode: team.template.mode,
      template_sections: team.template.sections,
      template_instructions: team.template.instructions,
    })
    .eq("id", team.id);

  if (error) throw error;
}

export async function updateTeamJoinCode(teamId: string, joinCode: string) {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase
    .from("teams")
    .update({ join_code: joinCode })
    .eq("id", teamId);

  if (error) throw error;
}

export async function loadReports(teamId: string, weekStart = currentWeekStart) {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase
    .from("reports")
    .select("id,employee_id,week_start,week_label,status,submitted_at,returned_comment,sections,profiles(id,email,full_name)")
    .eq("team_id", teamId)
    .eq("week_start", weekStart)
    .order("submitted_at", { ascending: false, nullsFirst: false });

  if (error) throw error;
  return ((data ?? []) as ReportRow[]).map(mapReport);
}

export async function loadEmployeeReports(teamId: string, employeeId: string) {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase
    .from("reports")
    .select("id,employee_id,week_start,week_label,status,submitted_at,returned_comment,sections,profiles(id,email,full_name)")
    .eq("team_id", teamId)
    .eq("employee_id", employeeId)
    .order("week_start", { ascending: false })
    .limit(16);

  if (error) throw error;
  return ((data ?? []) as ReportRow[]).map(mapReport);
}

export async function submitReport(input: {
  teamId: string;
  employeeId: string;
  weekStart: string;
  weekLabel: string;
  sections: Record<string, string>;
}) {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("reports").upsert(
    {
      team_id: input.teamId,
      employee_id: input.employeeId,
      week_start: input.weekStart,
      week_label: input.weekLabel,
      sections: input.sections,
      status: "submitted",
      submitted_at: new Date().toISOString(),
      returned_comment: null,
    },
    { onConflict: "team_id,employee_id,week_start" }
  );

  if (error) throw error;
}

export async function reviewReportInDb(reportId: string, status: "approved" | "returned", comment: string) {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase
    .from("reports")
    .update({
      status,
      returned_comment: status === "returned" ? comment || "Нужны уточнения перед принятием." : null,
    })
    .eq("id", reportId);

  if (error) throw error;
}

export async function saveSummary(input: {
  teamId: string;
  weekStart: string;
  content: Summary;
  createdBy: string;
}) {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("summaries").insert({
    team_id: input.teamId,
    week_start: input.weekStart,
    content: input.content,
    raw_text: input.content.raw,
    created_by: input.createdBy,
  });

  if (error) throw error;
}

export async function loadLatestSummary(teamId: string, weekStart = currentWeekStart) {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase
    .from("summaries")
    .select("content,raw_text")
    .eq("team_id", teamId)
    .eq("week_start", weekStart)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  const row = data as SummaryRow | null;
  return row?.content ?? null;
}
