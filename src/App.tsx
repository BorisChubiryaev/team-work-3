import type { Session, User } from "@supabase/supabase-js";
import {
  Bot,
  CalendarClock,
  Check,
  FileText,
  Home,
  KeyRound,
  ListChecks,
  LogOut,
  Mail,
  MessageSquareReply,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Table2,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  createTeam,
  ensureProfile,
  joinTeamByCode,
  loadLatestSummary,
  loadReports,
  loadTeams,
  reviewReportInDb,
  saveSummary,
  saveTeam,
  submitReport,
  updateTeamJoinCode,
} from "./lib/db";
import { currentWeekStart, getWeekLabelFromDateInput } from "./lib/dates";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import type { ReportStatus, Role, Summary, Team, TeamMember, WeeklyReport } from "./types";

type LeadTab = "home" | "reports" | "team" | "summary";
type MemberTab = "report" | "team";

const emptySummary: Summary = {
  highlights: [],
  blockers: [],
  nextSteps: [],
  risks: [],
  raw: "",
};

const statusLabels: Record<ReportStatus, string> = {
  draft: "Черновик",
  submitted: "На проверке",
  returned: "На исправлении",
  approved: "Принят",
};

const statusTone: Record<ReportStatus, string> = {
  draft: "muted",
  submitted: "ink",
  returned: "warn",
  approved: "good",
};

function createJoinCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function textFromReport(report: WeeklyReport) {
  return Object.entries(report.sections)
    .map(([section, value]) => `${section}:\n${value || "Не заполнено"}`)
    .join("\n\n");
}

async function callAi(action: "assist" | "summarize", payload: unknown) {
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });

  if (!response.ok) throw new Error("AI endpoint is not configured yet");
  return (await response.json()) as { text: string };
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<TeamMember | null>(null);
  const [authLoading, setAuthLoading] = useState(hasSupabaseConfig);
  const [authMessage, setAuthMessage] = useState("");
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedWeekStart, setSelectedWeekStart] = useState(currentWeekStart);
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [leadTab, setLeadTab] = useState<LeadTab>("home");
  const [memberTab, setMemberTab] = useState<MemberTab>("report");
  const [comment, setComment] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [newSection, setNewSection] = useState("");
  const [draftSections, setDraftSections] = useState<Record<string, string>>({});
  const [selectedReportId, setSelectedReportId] = useState("");
  const [aiDraft, setAiDraft] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [busy, setBusy] = useState(false);
  const [appError, setAppError] = useState("");

  const selectedWeekLabel = getWeekLabelFromDateInput(selectedWeekStart);
  const team = teams.find((item) => item.id === selectedTeamId) ?? teams[0] ?? null;
  const activeUser = profile;
  const role: Role =
    team?.members.find((member) => member.id === activeUser?.id)?.role ??
    (team?.leadId === activeUser?.id ? "lead" : "member");
  const selectedReport = reports.find((report) => report.id === selectedReportId) ?? reports[0] ?? null;
  const employees = team?.members.filter((member) => member.role === "member") ?? [];
  const memberReports = reports.filter((report) => report.employeeId !== team?.leadId);
  const reportByEmployee = new Map(memberReports.map((report) => [report.employeeId, report]));
  const missingEmployees = employees.filter((member) => !reportByEmployee.has(member.id));
  const completion = useMemo(() => {
    if (employees.length === 0) return 0;
    return Math.round(((employees.length - missingEmployees.length) / employees.length) * 100);
  }, [employees.length, missingEmployees.length]);
  const employeeReport = reports.find((report) => report.employeeId === activeUser?.id) ?? null;

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      setAuthLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!hasSupabaseConfig || !session?.user) {
      setProfile(null);
      setTeams([]);
      setReports([]);
      return;
    }

    void bootstrap(session.user);
    // Reload only when the authenticated user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  useEffect(() => {
    if (!team) return;

    setDraftSections((prev) => {
      const next = { ...prev };
      team.template.sections.forEach((section) => {
        next[section] = next[section] ?? "";
      });
      return next;
    });

    void reloadWeekData(team.id, selectedWeekStart);
    // Week data is keyed by selected team and selected week.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id, selectedWeekStart]);

  useEffect(() => {
    if (!team || !activeUser) return;
    const report = reports.find((item) => item.employeeId === activeUser.id);
    if (report) {
      setDraftSections((prev) => ({ ...prev, ...report.sections }));
      return;
    }

    setDraftSections((prev) => {
      const next: Record<string, string> = {};
      team.template.sections.forEach((section) => {
        next[section] = prev[section] ?? "";
      });
      return next;
    });
    // Draft hydration is tied to the selected user/team/report set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUser?.id, reports, team]);

  async function bootstrap(user: User) {
    setBusy(true);
    setAppError("");
    try {
      const nextProfile = await ensureProfile(user);
      setProfile({
        id: nextProfile.id,
        email: nextProfile.email,
        name: nextProfile.full_name || nextProfile.email,
        role: "member",
      });

      const loadedTeams = await loadTeams(user.id);
      setTeams(loadedTeams);
      setSelectedTeamId((current) =>
        current && loadedTeams.some((item) => item.id === current) ? current : loadedTeams[0]?.id ?? ""
      );
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Не удалось загрузить данные");
    } finally {
      setBusy(false);
    }
  }

  async function reloadWorkspace() {
    if (session?.user) await bootstrap(session.user);
  }

  async function reloadWeekData(teamId: string, weekStart = selectedWeekStart) {
    setBusy(true);
    setAppError("");
    try {
      const [loadedReports, latestSummary] = await Promise.all([
        loadReports(teamId, weekStart),
        loadLatestSummary(teamId, weekStart),
      ]);
      setReports(loadedReports);
      setSummary(latestSummary ?? emptySummary);
      setSelectedReportId((current) =>
        current && loadedReports.some((report) => report.id === current) ? current : loadedReports[0]?.id ?? ""
      );
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Не удалось загрузить неделю");
    } finally {
      setBusy(false);
    }
  }

  function updateLocalTeam(nextTeam: Team) {
    setTeams((prev) => prev.map((item) => (item.id === nextTeam.id ? nextTeam : item)));
  }

  async function persistTeam() {
    if (!team) return;
    const snapshot = team;
    setBusy(true);
    setAppError("");
    try {
      await saveTeam(snapshot);
      setAuthMessage("Команда сохранена");
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Не удалось сохранить команду");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateTeam(input: {
    name: string;
    deadlineDay: string;
    deadlineTime: string;
    sections: string[];
    instructions: string;
  }) {
    if (!session?.user) return;
    setBusy(true);
    setAppError("");
    try {
      await createTeam({ leadId: session.user.id, ...input });
      await reloadWorkspace();
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Не удалось создать команду");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinTeam(code = joinCode) {
    const codeToJoin = code.trim();
    if (!session?.user || !codeToJoin) return;
    setBusy(true);
    setAppError("");
    try {
      await joinTeamByCode(session.user.id, codeToJoin);
      setJoinCode("");
      await reloadWorkspace();
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Не удалось присоединиться по коду");
    } finally {
      setBusy(false);
    }
  }

  function updateTemplateField(field: "instructions" | "mode", value: string) {
    if (!team) return;
    updateLocalTeam({ ...team, template: { ...team.template, [field]: value } });
  }

  function addSection() {
    if (!team) return;
    const clean = newSection.trim();
    if (!clean || team.template.sections.includes(clean)) return;
    updateLocalTeam({
      ...team,
      template: { ...team.template, sections: [...team.template.sections, clean] },
    });
    setDraftSections((prev) => ({ ...prev, [clean]: "" }));
    setNewSection("");
  }

  async function regenerateCode() {
    if (!team) return;
    const nextCode = createJoinCode();
    updateLocalTeam({ ...team, joinCode: nextCode });
    setBusy(true);
    setAppError("");
    try {
      await updateTeamJoinCode(team.id, nextCode);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Не удалось обновить код");
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(section: string, value: string) {
    setDraftSections((prev) => ({ ...prev, [section]: value }));
  }

  async function submitDraft() {
    if (!team || !activeUser) return;
    const optimisticReport: WeeklyReport = {
      id: employeeReport?.id ?? "optimistic-report",
      employeeId: activeUser.id,
      employeeName: activeUser.name,
      week: selectedWeekLabel,
      status: "submitted",
      submittedAt: "только что",
      sections: draftSections,
    };
    setReports((prev) => {
      const withoutOwn = prev.filter((report) => report.employeeId !== activeUser.id);
      return [optimisticReport, ...withoutOwn];
    });
    setBusy(true);
    setAppError("");
    try {
      await submitReport({
        teamId: team.id,
        employeeId: activeUser.id,
        weekStart: selectedWeekStart,
        weekLabel: selectedWeekLabel,
        sections: draftSections,
      });
      await reloadWeekData(team.id, selectedWeekStart);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Не удалось отправить отчет");
    } finally {
      setBusy(false);
    }
  }

  async function reviewReport(status: "approved" | "returned") {
    if (!selectedReport || !team) return;
    const nextComment = status === "returned" ? comment || "Нужны уточнения перед принятием." : undefined;
    setReports((prev) =>
      prev.map((report) =>
        report.id === selectedReport.id ? { ...report, status, returnedComment: nextComment } : report
      )
    );
    setComment("");
    setBusy(true);
    setAppError("");
    try {
      await reviewReportInDb(selectedReport.id, status, comment);
      await reloadWeekData(team.id, selectedWeekStart);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Не удалось обновить отчет");
    } finally {
      setBusy(false);
    }
  }

  async function improveReport() {
    setAiBusy(true);
    setAiError("");
    try {
      const result = await callAi("assist", { template: team?.template, report: draftSections });
      setAiDraft(result.text);
    } catch {
      setAiError("AI API пока не настроен или временно недоступен.");
      setAiDraft(
        "### Как усилить отчет\n\n- Раздели активности по проектам.\n- Укажи результат, а не только факт встречи.\n- В блокерах напиши, чье решение требуется.\n- В планах добавь 2-3 измеримых шага."
      );
    } finally {
      setAiBusy(false);
    }
  }

  async function summarizeReports() {
    if (!team || !session?.user) return;
    setAiBusy(true);
    setAiError("");
    try {
      const result = await callAi("summarize", {
        teamName: team.name,
        week: selectedWeekLabel,
        reports: memberReports.map((report) => ({
          employeeName: report.employeeName,
          status: report.status,
          content: textFromReport(report),
        })),
      });
      const nextSummary = { ...emptySummary, raw: result.text };
      setSummary(nextSummary);
      await saveSummary({
        teamId: team.id,
        weekStart: selectedWeekStart,
        content: nextSummary,
        createdBy: session.user.id,
      });
    } catch {
      setAiError("Не удалось получить AI-сводку. Проверь OPENROUTER_API_KEY на Vercel.");
    } finally {
      setAiBusy(false);
    }
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setTeams([]);
    setReports([]);
  }

  if (authLoading) return <LoadingScreen />;
  if (!hasSupabaseConfig) return <SetupScreen />;
  if (!session) return <AuthScreen message={authMessage} setMessage={setAuthMessage} />;

  if (teams.length === 0) {
    return (
      <main className="app-shell app-with-nav">
        <ShellHeader title="Старт" profile={profile} onSignOut={signOut} />
        {appError && <p className="global-error">{appError}</p>}
        <Onboarding
          busy={busy}
          joinCode={joinCode}
          setJoinCode={setJoinCode}
          onJoin={() => handleJoinTeam()}
          onCreate={handleCreateTeam}
        />
      </main>
    );
  }

  if (!team) return <LoadingScreen />;

  return (
    <main className="app-shell app-with-nav">
      <ShellHeader title={team.name} profile={profile} onSignOut={signOut} />
      {appError && <p className="global-error">{appError}</p>}
      {authMessage && <p className="global-success">{authMessage}</p>}

      <WorkspaceToolbar
        teams={teams}
        selectedTeamId={team.id}
        onSelectTeam={setSelectedTeamId}
        selectedWeekStart={selectedWeekStart}
        setSelectedWeekStart={setSelectedWeekStart}
      />

      {role === "lead" ? (
        <LeadWorkspace
          tab={leadTab}
          team={team}
          updateLocalTeam={updateLocalTeam}
          selectedReport={selectedReport}
          reports={reports}
          setSelectedReportId={setSelectedReportId}
          completion={completion}
          employees={employees}
          reportByEmployee={reportByEmployee}
          missingEmployees={missingEmployees}
          summary={summary}
          comment={comment}
          setComment={setComment}
          aiBusy={aiBusy}
          aiError={aiError}
          busy={busy}
          addSection={addSection}
          newSection={newSection}
          setNewSection={setNewSection}
          reviewReport={reviewReport}
          summarizeReports={summarizeReports}
          updateTemplateField={updateTemplateField}
          persistTeam={persistTeam}
          regenerateCode={regenerateCode}
          selectedWeekLabel={selectedWeekLabel}
        />
      ) : (
        <MemberWorkspace
          tab={memberTab}
          team={team}
          joinCode={joinCode}
          setJoinCode={setJoinCode}
          onJoin={() => handleJoinTeam()}
          draftSections={draftSections}
          updateDraft={updateDraft}
          submitDraft={submitDraft}
          improveReport={improveReport}
          aiBusy={aiBusy}
          aiDraft={aiDraft}
          aiError={aiError}
          busy={busy}
          employeeReport={employeeReport}
          selectedWeekLabel={selectedWeekLabel}
        />
      )}

      {role === "lead" ? (
        <BottomNav
          items={[
            { id: "home", label: "Главная", icon: Home },
            { id: "reports", label: "Отчеты", icon: ListChecks },
            { id: "team", label: "Команда", icon: UsersRound },
            { id: "summary", label: "Сводка", icon: Sparkles },
          ]}
          active={leadTab}
          onChange={(value) => setLeadTab(value as LeadTab)}
        />
      ) : (
        <BottomNav
          items={[
            { id: "report", label: "Отчет", icon: PencilLine },
            { id: "team", label: "Команда", icon: UsersRound },
          ]}
          active={memberTab}
          onChange={(value) => setMemberTab(value as MemberTab)}
        />
      )}
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="app-shell centered-shell">
      <section className="paper-panel auth-panel">
        <div className="panel-title">
          <RefreshCw />
          <div>
            <p>Еженедельник</p>
            <h2>Загружаю</h2>
          </div>
        </div>
      </section>
    </main>
  );
}

function SetupScreen() {
  return (
    <main className="app-shell centered-shell">
      <section className="paper-panel auth-panel">
        <div className="panel-title">
          <KeyRound />
          <div>
            <p>Настройка</p>
            <h2>Подключи Supabase</h2>
          </div>
        </div>
        <p className="note">
          Приложение больше не использует моковые данные. Добавь `VITE_SUPABASE_URL` и
          `VITE_SUPABASE_ANON_KEY` в `.env.local`, затем перезапусти dev server.
        </p>
      </section>
    </main>
  );
}

function ShellHeader({
  title,
  profile,
  onSignOut,
}: {
  title: string;
  profile: TeamMember | null;
  onSignOut: () => void;
}) {
  return (
    <section className="compact-header">
      <div>
        <p className="eyebrow">Еженедельник</p>
        <h1>{title}</h1>
      </div>
      <div className="header-actions">
        {profile && <span className="user-pill">{profile.name}</span>}
        <button className="icon-button" onClick={onSignOut} aria-label="Выйти">
          <LogOut size={18} />
        </button>
      </div>
    </section>
  );
}

function WorkspaceToolbar({
  teams,
  selectedTeamId,
  onSelectTeam,
  selectedWeekStart,
  setSelectedWeekStart,
}: {
  teams: Team[];
  selectedTeamId: string;
  onSelectTeam: (id: string) => void;
  selectedWeekStart: string;
  setSelectedWeekStart: (value: string) => void;
}) {
  return (
    <section className="workspace-toolbar">
      {teams.length > 1 && (
        <select value={selectedTeamId} onChange={(event) => onSelectTeam(event.target.value)}>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      )}
      <label>
        Неделя
        <input
          type="date"
          value={selectedWeekStart}
          onChange={(event) => setSelectedWeekStart(event.target.value)}
        />
      </label>
    </section>
  );
}

function AuthScreen({
  message,
  setMessage,
}: {
  message: string;
  setMessage: (value: string) => void;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: window.location.origin,
          },
        });
        if (signUpError) throw signUpError;
        if (data.user && data.session) await ensureProfile(data.user, fullName);
        setMessage(
          data.session
            ? "Аккаунт создан, вход выполнен."
            : "Письмо подтверждения отправлено. Открой ссылку из письма, затем войди."
        );
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    if (!supabase) return;
    setBusy(true);
    setError("");
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (oauthError) {
      setError(oauthError.message);
      setBusy(false);
    }
  }

  return (
    <main className="app-shell centered-shell">
      <section className="paper-panel auth-panel">
        <div className="panel-title">
          <KeyRound />
          <div>
            <p>Аккаунт</p>
            <h2>{mode === "login" ? "Войти" : "Регистрация"}</h2>
          </div>
        </div>
        <div className="segmented">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            Вход
          </button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>
            Регистрация
          </button>
        </div>
        <form className="auth-form" onSubmit={submitAuth}>
          {mode === "signup" && (
            <label>
              Имя
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} required />
            </label>
          )}
          <label>
            Почта
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Пароль
            <input
              type="password"
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            <Mail size={17} />
            {busy ? "Проверяю..." : mode === "login" ? "Войти" : "Зарегистрироваться"}
          </button>
        </form>
        <button className="secondary wide-button" onClick={signInWithGoogle} disabled={busy}>
          <KeyRound size={17} />
          Google
        </button>
        {message && <p className="global-success">{message}</p>}
        {error && <p className="global-error">{error}</p>}
      </section>
    </main>
  );
}

function Onboarding({
  busy,
  joinCode,
  setJoinCode,
  onJoin,
  onCreate,
}: {
  busy: boolean;
  joinCode: string;
  setJoinCode: (value: string) => void;
  onJoin: () => void;
  onCreate: (input: {
    name: string;
    deadlineDay: string;
    deadlineTime: string;
    sections: string[];
    instructions: string;
  }) => void;
}) {
  const [name, setName] = useState("Новая команда");
  const [deadlineDay, setDeadlineDay] = useState("Пятница");
  const [deadlineTime, setDeadlineTime] = useState("18:00");
  const [sections, setSections] = useState("Сделано, Блокеры, Планы");
  const [instructions, setInstructions] = useState(
    "Пиши конкретно: проект, результат, блокеры, планы и где нужна помощь."
  );

  return (
    <div className="workspace onboarding-grid">
      <section className="paper-panel">
        <div className="panel-title">
          <UsersRound />
          <div>
            <p>Руководитель</p>
            <h2>Создать команду</h2>
          </div>
        </div>
        <label>
          Название
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="deadline-row">
          <label>
            День
            <select value={deadlineDay} onChange={(event) => setDeadlineDay(event.target.value)}>
              {["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"].map((day) => (
                <option key={day}>{day}</option>
              ))}
            </select>
          </label>
          <label>
            До
            <input type="time" value={deadlineTime} onChange={(event) => setDeadlineTime(event.target.value)} />
          </label>
        </div>
        <label>
          Разделы через запятую
          <input value={sections} onChange={(event) => setSections(event.target.value)} />
        </label>
        <label>
          Инструкция
          <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={4} />
        </label>
        <button
          disabled={busy}
          onClick={() =>
            onCreate({
              name,
              deadlineDay,
              deadlineTime,
              sections: sections.split(",").map((item) => item.trim()).filter(Boolean),
              instructions,
            })
          }
        >
          <Plus size={17} />
          Создать
        </button>
      </section>

      <section className="paper-panel">
        <div className="panel-title">
          <KeyRound />
          <div>
            <p>Сотрудник</p>
            <h2>Войти по коду</h2>
          </div>
        </div>
        <div className="add-row">
          <input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder="Например NOTE42"
          />
          <button disabled={busy || !joinCode} onClick={onJoin}>
            Войти
          </button>
        </div>
      </section>
    </div>
  );
}

type LeadProps = {
  tab: LeadTab;
  team: Team;
  updateLocalTeam: (team: Team) => void;
  selectedReport: WeeklyReport | null;
  reports: WeeklyReport[];
  setSelectedReportId: (id: string) => void;
  completion: number;
  employees: Team["members"];
  reportByEmployee: Map<string, WeeklyReport>;
  missingEmployees: Team["members"];
  summary: Summary;
  comment: string;
  setComment: (value: string) => void;
  aiBusy: boolean;
  aiError: string;
  busy: boolean;
  addSection: () => void;
  newSection: string;
  setNewSection: (value: string) => void;
  reviewReport: (status: "approved" | "returned") => void;
  summarizeReports: () => void;
  updateTemplateField: (field: "instructions" | "mode", value: string) => void;
  persistTeam: () => void;
  regenerateCode: () => void;
  selectedWeekLabel: string;
};

function LeadWorkspace(props: LeadProps) {
  const {
    tab,
    team,
    updateLocalTeam,
    selectedReport,
    reports,
    setSelectedReportId,
    completion,
    employees,
    reportByEmployee,
    missingEmployees,
    summary,
    comment,
    setComment,
    aiBusy,
    aiError,
    busy,
    addSection,
    newSection,
    setNewSection,
    reviewReport,
    summarizeReports,
    updateTemplateField,
    persistTeam,
    regenerateCode,
    selectedWeekLabel,
  } = props;

  if (tab === "home") {
    return (
      <div className="workspace dashboard-grid">
        <StatusPanel
          team={team}
          completion={completion}
          employees={employees}
          reportByEmployee={reportByEmployee}
          missingEmployees={missingEmployees}
          setSelectedReportId={setSelectedReportId}
        />
        <section className="paper-panel">
          <div className="panel-title">
            <CalendarClock />
            <div>
              <p>Неделя</p>
              <h2>{selectedWeekLabel}</h2>
            </div>
          </div>
          <p className="note">Отправлено отчетов: {reports.length}. На проверке: {reports.filter((r) => r.status === "submitted").length}.</p>
        </section>
      </div>
    );
  }

  if (tab === "reports") {
    return (
      <div className="workspace reports-grid">
        <StatusPanel
          team={team}
          completion={completion}
          employees={employees}
          reportByEmployee={reportByEmployee}
          missingEmployees={missingEmployees}
          setSelectedReportId={setSelectedReportId}
        />
        <ReportReader
          selectedReport={selectedReport}
          comment={comment}
          setComment={setComment}
          reviewReport={reviewReport}
          busy={busy}
        />
        <ReportTable reports={reports} />
      </div>
    );
  }

  if (tab === "team") {
    return (
      <div className="workspace team-settings-grid">
        <TeamSettings
          team={team}
          updateLocalTeam={updateLocalTeam}
          persistTeam={persistTeam}
          regenerateCode={regenerateCode}
          busy={busy}
        />
        <TemplateSettings
          team={team}
          updateTemplateField={updateTemplateField}
          addSection={addSection}
          newSection={newSection}
          setNewSection={setNewSection}
        />
      </div>
    );
  }

  return (
    <div className="workspace summary-only-grid">
      <SummaryPanel
        summary={summary}
        reports={reports}
        aiBusy={aiBusy}
        aiError={aiError}
        summarizeReports={summarizeReports}
      />
    </div>
  );
}

type MemberProps = {
  tab: MemberTab;
  team: Team;
  joinCode: string;
  setJoinCode: (value: string) => void;
  onJoin: () => void;
  draftSections: Record<string, string>;
  updateDraft: (section: string, value: string) => void;
  submitDraft: () => void;
  improveReport: () => void;
  aiBusy: boolean;
  aiDraft: string;
  aiError: string;
  busy: boolean;
  employeeReport: WeeklyReport | null;
  selectedWeekLabel: string;
};

function MemberWorkspace(props: MemberProps) {
  const {
    tab,
    team,
    joinCode,
    setJoinCode,
    onJoin,
    draftSections,
    updateDraft,
    submitDraft,
    improveReport,
    aiBusy,
    aiDraft,
    aiError,
    busy,
    employeeReport,
    selectedWeekLabel,
  } = props;

  if (tab === "team") {
    return (
      <div className="workspace member-team-grid">
        <section className="paper-panel">
          <div className="panel-title">
            <CalendarClock />
            <div>
              <p>{team.name}</p>
              <h2>До {team.deadlineDay.toLowerCase()}, {team.deadlineTime}</h2>
            </div>
          </div>
          <p className="note">{team.template.instructions}</p>
        </section>
        <section className="paper-panel">
          <div className="panel-title">
            <KeyRound />
            <div>
              <p>Еще команда</p>
              <h2>Войти по коду</h2>
            </div>
          </div>
          <div className="add-row">
            <input
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              placeholder="Например NOTE42"
            />
            <button disabled={!joinCode || busy} onClick={onJoin}>
              Войти
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="workspace member-report-grid">
      <section className="paper-panel editor-panel">
        <div className="panel-title">
          <PencilLine />
          <div>
            <p>Мой отчет</p>
            <h2>Неделя {selectedWeekLabel}</h2>
          </div>
        </div>
        {employeeReport?.returnedComment && (
          <div className="teacher-note">
            <strong>Комментарий руководителя</strong>
            <span>{employeeReport.returnedComment}</span>
          </div>
        )}
        {team.template.sections.map((section) => (
          <label key={section}>
            {section}
            <textarea
              value={draftSections[section] ?? ""}
              onChange={(event) => updateDraft(section, event.target.value)}
              rows={section === "Сделано" ? 8 : 4}
            />
          </label>
        ))}
        <div className="actions">
          <button className="secondary" onClick={improveReport} disabled={aiBusy}>
            <Bot size={17} />
            {aiBusy ? "Думаю..." : "Помочь"}
          </button>
          <button onClick={submitDraft} disabled={busy}>
            <Send size={17} />
            Отправить
          </button>
        </div>
      </section>

      <section className="paper-panel ai-panel">
        <div className="panel-title">
          <Sparkles />
          <div>
            <p>AI-помощник</p>
            <h2>Редактор смысла</h2>
          </div>
        </div>
        {aiError && <p className="error-line">{aiError}</p>}
        <MarkdownContent
          value={
            aiDraft ||
            "Нажми **Помочь**, и помощник предложит, как сделать отчет яснее для руководителя."
          }
        />
      </section>
    </div>
  );
}

function StatusPanel({
  team,
  completion,
  employees,
  reportByEmployee,
  missingEmployees,
  setSelectedReportId,
}: {
  team: Team;
  completion: number;
  employees: Team["members"];
  reportByEmployee: Map<string, WeeklyReport>;
  missingEmployees: Team["members"];
  setSelectedReportId: (id: string) => void;
}) {
  return (
    <section className="paper-panel status-panel">
      <div className="panel-title">
        <CalendarClock />
        <div>
          <p>Дедлайн: {team.deadlineDay}, {team.deadlineTime}</p>
          <h2>{completion}% сдали</h2>
        </div>
      </div>
      <div className="progress">
        <span style={{ width: `${completion}%` }} />
      </div>
      <div className="employee-list">
        {employees.map((employee) => {
          const report = reportByEmployee.get(employee.id);
          return (
            <button key={employee.id} onClick={() => report && setSelectedReportId(report.id)}>
              <span>{employee.name}</span>
              <Badge status={report?.status ?? "draft"}>{report ? statusLabels[report.status] : "Не сдал"}</Badge>
            </button>
          );
        })}
      </div>
      {missingEmployees.length > 0 && (
        <p className="note">Не отправили: {missingEmployees.map((member) => member.name).join(", ")}</p>
      )}
    </section>
  );
}

function TeamSettings({
  team,
  updateLocalTeam,
  persistTeam,
  regenerateCode,
  busy,
}: {
  team: Team;
  updateLocalTeam: (team: Team) => void;
  persistTeam: () => void;
  regenerateCode: () => void;
  busy: boolean;
}) {
  return (
    <section className="paper-panel team-panel">
      <div className="panel-title">
        <UsersRound />
        <div>
          <p>Команда</p>
          <h2>{team.name}</h2>
        </div>
      </div>
      <label>
        Название
        <input value={team.name} onChange={(event) => updateLocalTeam({ ...team, name: event.target.value })} />
      </label>
      <div className="deadline-row">
        <label>
          День
          <select
            value={team.deadlineDay}
            onChange={(event) => updateLocalTeam({ ...team, deadlineDay: event.target.value })}
          >
            {["Понедельник", "Вторник", "Среда", "Четверг", "Пятница"].map((day) => (
              <option key={day}>{day}</option>
            ))}
          </select>
        </label>
        <label>
          До
          <input
            type="time"
            value={team.deadlineTime}
            onChange={(event) => updateLocalTeam({ ...team, deadlineTime: event.target.value })}
          />
        </label>
      </div>
      <div className="join-card">
        <span>Код для сотрудников</span>
        <strong>{team.joinCode}</strong>
        <button onClick={regenerateCode} disabled={busy} aria-label="Обновить код">
          <RefreshCw size={16} />
        </button>
      </div>
      <button onClick={persistTeam} disabled={busy}>
        <Save size={17} />
        Сохранить
      </button>
    </section>
  );
}

function TemplateSettings({
  team,
  updateTemplateField,
  addSection,
  newSection,
  setNewSection,
}: {
  team: Team;
  updateTemplateField: (field: "instructions" | "mode", value: string) => void;
  addSection: () => void;
  newSection: string;
  setNewSection: (value: string) => void;
}) {
  return (
    <section className="paper-panel">
      <div className="panel-title">
        <FileText />
        <div>
          <p>Форма</p>
          <h2>Шаблон отчета</h2>
        </div>
      </div>
      <div className="segmented">
        <button
          className={team.template.mode === "structured" ? "active" : ""}
          onClick={() => updateTemplateField("mode", "structured")}
        >
          Разделы
        </button>
        <button
          className={team.template.mode === "free" ? "active" : ""}
          onClick={() => updateTemplateField("mode", "free")}
        >
          Текст
        </button>
      </div>
      <label>
        Инструкция
        <textarea
          value={team.template.instructions}
          onChange={(event) => updateTemplateField("instructions", event.target.value)}
          rows={4}
        />
      </label>
      <div className="chips">
        {team.template.sections.map((section) => (
          <span key={section}>{section}</span>
        ))}
      </div>
      <div className="add-row">
        <input value={newSection} onChange={(event) => setNewSection(event.target.value)} placeholder="Новый раздел" />
        <button onClick={addSection}>
          <Plus size={16} />
        </button>
      </div>
    </section>
  );
}

function ReportReader({
  selectedReport,
  comment,
  setComment,
  reviewReport,
  busy,
}: {
  selectedReport: WeeklyReport | null;
  comment: string;
  setComment: (value: string) => void;
  reviewReport: (status: "approved" | "returned") => void;
  busy: boolean;
}) {
  return (
    <section className="paper-panel report-reader">
      {selectedReport ? (
        <>
          <div className="panel-title">
            <MessageSquareReply />
            <div>
              <p>{selectedReport.employeeName}</p>
              <h2>Отчет за {selectedReport.week}</h2>
            </div>
          </div>
          <Badge status={selectedReport.status}>{statusLabels[selectedReport.status]}</Badge>
          <div className="report-body">
            {Object.entries(selectedReport.sections).map(([section, content]) => (
              <article key={section}>
                <h3>{section}</h3>
                <p>{content || "Раздел не заполнен"}</p>
              </article>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={3}
            placeholder="Комментарий для возврата"
          />
          <div className="actions">
            <button className="secondary" onClick={() => reviewReport("returned")} disabled={busy}>
              <X size={17} />
              Вернуть
            </button>
            <button onClick={() => reviewReport("approved")} disabled={busy}>
              <Check size={17} />
              Принять
            </button>
          </div>
        </>
      ) : (
        <EmptyPanel title="Отчетов пока нет" text="Когда сотрудники отправят отчеты, они появятся здесь." />
      )}
    </section>
  );
}

function ReportTable({ reports }: { reports: WeeklyReport[] }) {
  return (
    <section className="paper-panel table-panel">
      <div className="panel-title">
        <Table2 />
        <div>
          <p>Сверка</p>
          <h2>Отчеты и статусы</h2>
        </div>
      </div>
      <div className="report-table">
        <div className="table-head">Сотрудник</div>
        <div className="table-head">Статус</div>
        <div className="table-head">Коротко</div>
        {reports.map((report) => (
          <div className="table-row" key={report.id}>
            <strong>{report.employeeName}</strong>
            <Badge status={report.status}>{statusLabels[report.status]}</Badge>
            <span>{Object.values(report.sections).join(" ").slice(0, 130)}...</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SummaryPanel({
  summary,
  reports,
  aiBusy,
  aiError,
  summarizeReports,
}: {
  summary: Summary;
  reports: WeeklyReport[];
  aiBusy: boolean;
  aiError: string;
  summarizeReports: () => void;
}) {
  return (
    <section className="paper-panel summary-panel">
      <div className="panel-title">
        <Sparkles />
        <div>
          <p>AI-сводка</p>
          <h2>Для руководителя</h2>
        </div>
      </div>
      <button className="wide-button" onClick={summarizeReports} disabled={aiBusy || reports.length === 0}>
        <Sparkles size={18} />
        {aiBusy ? "Собираю..." : "Суммаризировать"}
      </button>
      {aiError && <p className="error-line">{aiError}</p>}
      {summary.raw ? <MarkdownContent value={summary.raw} /> : <EmptyPanel title="Сводки пока нет" text="Запусти AI-суммаризацию после отправки отчетов." />}
    </section>
  );
}

function MarkdownContent({ value }: { value: string }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown>{value}</ReactMarkdown>
    </div>
  );
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-panel">
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

function Badge({ status, children }: { status: ReportStatus; children: React.ReactNode }) {
  return <span className={`badge ${statusTone[status]}`}>{children}</span>;
}

function BottomNav({
  items,
  active,
  onChange,
}: {
  items: Array<{ id: string; label: string; icon: React.ComponentType<{ size?: number }> }>;
  active: string;
  onChange: (value: string) => void;
}) {
  return (
    <nav className="bottom-nav">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => onChange(item.id)}>
            <Icon size={20} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default App;
