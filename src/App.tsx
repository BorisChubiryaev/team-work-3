import type { Session, User } from "@supabase/supabase-js";
import {
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  KeyRound,
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
import { currentUser, employeeUser, initialReports, initialSummary, initialTeam } from "./data";
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
import { currentWeekLabel, currentWeekStart } from "./lib/dates";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import type { ReportStatus, Role, Summary, Team, TeamMember, WeeklyReport } from "./types";

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
  const [teams, setTeams] = useState<Team[]>(hasSupabaseConfig ? [] : [initialTeam]);
  const [selectedTeamId, setSelectedTeamId] = useState(initialTeam.id);
  const [reports, setReports] = useState<WeeklyReport[]>(hasSupabaseConfig ? [] : initialReports);
  const [summary, setSummary] = useState<Summary>(initialSummary);
  const [previewRole, setPreviewRole] = useState<Role>("lead");
  const [comment, setComment] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [newSection, setNewSection] = useState("");
  const [draftSections, setDraftSections] = useState<Record<string, string>>({
    Сделано:
      "Встреча с AI Lab / подготовка конференции RecSys 2026.\nДемо МАРК / проекты / участие в обсуждении.",
    Блокеры: "Нужны уточнения по владельцам данных и срокам поставок.",
    Планы:
      "Собрать обратную связь от юнитов.\nПодготовить короткую сводку по рискам и зависимостям.",
  });
  const [selectedReportId, setSelectedReportId] = useState(initialReports[0]?.id ?? "");
  const [aiDraft, setAiDraft] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [busy, setBusy] = useState(false);
  const [appError, setAppError] = useState("");

  const team = teams.find((item) => item.id === selectedTeamId) ?? teams[0] ?? null;
  const activeUser = profile ?? (previewRole === "lead" ? currentUser : employeeUser);
  const currentMembershipRole =
    team?.members.find((member) => member.id === activeUser.id)?.role ?? previewRole;
  const role = hasSupabaseConfig ? currentMembershipRole : previewRole;
  const selectedReport = reports.find((report) => report.id === selectedReportId) ?? reports[0] ?? null;
  const employees = team?.members.filter((member) => member.role === "member") ?? [];
  const memberReports = reports.filter((report) => report.employeeId !== team?.leadId);
  const reportByEmployee = new Map(memberReports.map((report) => [report.employeeId, report]));
  const missingEmployees = employees.filter((member) => !reportByEmployee.has(member.id));
  const completion = useMemo(() => {
    if (employees.length === 0) return 0;
    return Math.round(((employees.length - missingEmployees.length) / employees.length) * 100);
  }, [employees.length, missingEmployees.length]);

  const employeeReport =
    reports.find((report) => report.employeeId === activeUser.id) ??
    ({
      id: "report-new",
      employeeId: activeUser.id,
      employeeName: activeUser.name,
      week: currentWeekLabel,
      status: "draft",
      sections: draftSections,
    } satisfies WeeklyReport);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) return;

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
      if (hasSupabaseConfig) {
        setProfile(null);
        setTeams([]);
        setReports([]);
      }
      return;
    }

    void bootstrap(session.user);
    // The workspace should reload when the authenticated identity changes.
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

    if (hasSupabaseConfig) void reloadReports(team.id);
    // Template hydration and report reload are intentionally keyed by selected team.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id]);

  async function bootstrap(user: User) {
    setBusy(true);
    setAppError("");
    try {
      const nextProfile = await ensureProfile(user);
      const member: TeamMember = {
        id: nextProfile.id,
        email: nextProfile.email,
        name: nextProfile.full_name || nextProfile.email,
        role: "member",
      };
      setProfile(member);

      const loadedTeams = await loadTeams(user.id);
      setTeams(loadedTeams);
      if (loadedTeams[0]) {
        setSelectedTeamId(loadedTeams[0].id);
        await reloadReports(loadedTeams[0].id);
        const latestSummary = await loadLatestSummary(loadedTeams[0].id);
        if (latestSummary) setSummary(latestSummary);
      }
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Не удалось загрузить данные");
    } finally {
      setBusy(false);
    }
  }

  async function reloadWorkspace() {
    if (!session?.user) return;
    await bootstrap(session.user);
  }

  async function reloadReports(teamId: string) {
    if (!hasSupabaseConfig) return;
    const loadedReports = await loadReports(teamId);
    setReports(loadedReports);
    setSelectedReportId(loadedReports[0]?.id ?? "");
  }

  function updateLocalTeam(nextTeam: Team) {
    setTeams((prev) => prev.map((item) => (item.id === nextTeam.id ? nextTeam : item)));
  }

  async function persistTeam(nextTeam = team) {
    if (!nextTeam) return;
    setBusy(true);
    setAppError("");
    try {
      if (hasSupabaseConfig) await saveTeam(nextTeam);
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
      await createTeam({
        leadId: session.user.id,
        name: input.name,
        deadlineDay: input.deadlineDay,
        deadlineTime: input.deadlineTime,
        sections: input.sections,
        instructions: input.instructions,
      });
      await reloadWorkspace();
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Не удалось создать команду");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinTeam(code = joinCode) {
    if (!session?.user) return;
    setBusy(true);
    setAppError("");
    try {
      await joinTeamByCode(session.user.id, code);
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
      template: {
        ...team.template,
        sections: [...team.template.sections, clean],
      },
    });
    setDraftSections((prev) => ({ ...prev, [clean]: "" }));
    setNewSection("");
  }

  async function regenerateCode() {
    if (!team) return;
    const joinCode = createJoinCode();
    const nextTeam = { ...team, joinCode };
    updateLocalTeam(nextTeam);
    if (hasSupabaseConfig) {
      setBusy(true);
      try {
        await updateTeamJoinCode(team.id, joinCode);
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Не удалось обновить код");
      } finally {
        setBusy(false);
      }
    }
  }

  function updateDraft(section: string, value: string) {
    setDraftSections((prev) => ({ ...prev, [section]: value }));
  }

  async function submitDraft() {
    if (!team) return;
    setBusy(true);
    setAppError("");
    try {
      if (hasSupabaseConfig) {
        await submitReport({
          teamId: team.id,
          employeeId: activeUser.id,
          weekStart: currentWeekStart,
          weekLabel: currentWeekLabel,
          sections: draftSections,
        });
        await reloadReports(team.id);
      } else {
        const nextReport: WeeklyReport = {
          ...employeeReport,
          sections: draftSections,
          status: "submitted",
          submittedAt: "Сегодня, 17:05",
          returnedComment: undefined,
        };
        setReports((prev) => {
          const exists = prev.some((report) => report.id === nextReport.id);
          return exists
            ? prev.map((report) => (report.id === nextReport.id ? nextReport : report))
            : [nextReport, ...prev];
        });
        setSelectedReportId(nextReport.id);
      }
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Не удалось отправить отчет");
    } finally {
      setBusy(false);
    }
  }

  async function reviewReport(status: "approved" | "returned") {
    if (!selectedReport || !team) return;
    setBusy(true);
    setAppError("");
    try {
      if (hasSupabaseConfig) {
        await reviewReportInDb(selectedReport.id, status, comment);
        await reloadReports(team.id);
      } else {
        setReports((prev) =>
          prev.map((report) =>
            report.id === selectedReport.id
              ? {
                  ...report,
                  status,
                  returnedComment:
                    status === "returned" ? comment || "Нужны уточнения перед принятием." : undefined,
                }
              : report
          )
        );
      }
      setComment("");
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
      const result = await callAi("assist", {
        template: team?.template,
        report: draftSections,
      });
      setAiDraft(result.text);
    } catch {
      setAiError(
        "AI API пока не настроен локально. После добавления OPENROUTER_API_KEY на Vercel помощник начнет отвечать."
      );
      setAiDraft(
        "Можно усилить отчет так:\n- Разделить активности по проектам.\n- Указать результат, а не только факт встречи.\n- В блокерах явно написать, чье решение требуется.\n- В планах добавить 2-3 измеримых шага на следующую неделю."
      );
    } finally {
      setAiBusy(false);
    }
  }

  async function summarizeReports() {
    if (!team) return;
    setAiBusy(true);
    setAiError("");
    try {
      const result = await callAi("summarize", {
        teamName: team.name,
        reports: memberReports.map((report) => ({
          employeeName: report.employeeName,
          status: report.status,
          content: textFromReport(report),
        })),
      });
      const nextSummary = { ...summary, raw: result.text };
      setSummary(nextSummary);
      if (hasSupabaseConfig && session?.user) {
        await saveSummary({
          teamId: team.id,
          weekStart: currentWeekStart,
          content: nextSummary,
          createdBy: session.user.id,
        });
      }
    } catch {
      setAiError(
        "Суммаризация сейчас работает в демо-режиме. Для настоящих ответов добавь OPENROUTER_API_KEY в переменные окружения Vercel."
      );
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

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (hasSupabaseConfig && !session) {
    return <AuthScreen message={authMessage} setMessage={setAuthMessage} />;
  }

  if (hasSupabaseConfig && teams.length === 0) {
    return (
      <main className="app-shell">
        <ShellHeader
          role={role}
          setRole={setPreviewRole}
          profile={profile}
          onSignOut={signOut}
          canSwitchRole={false}
        />
        {appError && <p className="global-error">{appError}</p>}
        <Onboarding
          busy={busy}
          joinCode={joinCode}
          setJoinCode={setJoinCode}
          onJoin={handleJoinTeam}
          onCreate={handleCreateTeam}
        />
      </main>
    );
  }

  if (!team) {
    return <LoadingScreen />;
  }

  return (
    <main className="app-shell">
      <ShellHeader
        role={role}
        setRole={setPreviewRole}
        profile={profile}
        onSignOut={hasSupabaseConfig ? signOut : undefined}
        canSwitchRole={!hasSupabaseConfig}
      />

      {!hasSupabaseConfig && (
        <p className="config-banner">
          Демо-режим: добавь `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`, чтобы включить настоящий логин и базу.
        </p>
      )}
      {appError && <p className="global-error">{appError}</p>}
      {authMessage && <p className="global-success">{authMessage}</p>}

      {hasSupabaseConfig && teams.length > 1 && (
        <section className="team-tabs">
          {teams.map((item) => (
            <button
              key={item.id}
              className={item.id === team.id ? "active" : ""}
              onClick={() => setSelectedTeamId(item.id)}
            >
              {item.name}
            </button>
          ))}
        </section>
      )}

      {role === "lead" ? (
        <LeadWorkspace
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
        />
      ) : (
        <MemberWorkspace
          team={team}
          joinCode={joinCode}
          setJoinCode={setJoinCode}
          onJoin={handleJoinTeam}
          draftSections={draftSections}
          updateDraft={updateDraft}
          submitDraft={submitDraft}
          improveReport={improveReport}
          aiBusy={aiBusy}
          aiDraft={aiDraft}
          aiError={aiError}
          busy={busy}
          employeeReport={employeeReport}
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
            <h2>Загружаю рабочее пространство</h2>
          </div>
        </div>
      </section>
    </main>
  );
}

function ShellHeader({
  role,
  setRole,
  profile,
  onSignOut,
  canSwitchRole,
}: {
  role: Role;
  setRole: (role: Role) => void;
  profile: TeamMember | null;
  onSignOut?: () => void;
  canSwitchRole: boolean;
}) {
  return (
    <>
      <section className="topbar">
        <div>
          <p className="eyebrow">Еженедельник</p>
          <h1>Отчеты команды без ручной сводки</h1>
        </div>
        <div className="header-actions">
          <div className="role-switch" aria-label="Выбор роли">
            <button
              className={role === "lead" ? "active" : ""}
              onClick={() => canSwitchRole && setRole("lead")}
              disabled={!canSwitchRole}
            >
              <ClipboardCheck size={18} />
              Руководитель
            </button>
            <button
              className={role === "member" ? "active" : ""}
              onClick={() => canSwitchRole && setRole("member")}
              disabled={!canSwitchRole}
            >
              <PencilLine size={18} />
              Сотрудник
            </button>
          </div>
          {profile && <span className="user-pill">{profile.name}</span>}
          {onSignOut && (
            <button className="icon-button" onClick={onSignOut} aria-label="Выйти">
              <LogOut size={18} />
            </button>
          )}
        </div>
      </section>

      <section className="auth-strip">
        <div>
          <Mail size={18} />
          Вход по почте
        </div>
        <div>
          <KeyRound size={18} />
          Google OAuth через Supabase Auth
        </div>
        <div>
          <Bot size={18} />
          OpenRouter AI через Vercel Function
        </div>
      </section>
    </>
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
        setMessage("Регистрация создана. Если включено подтверждение почты, проверь письмо.");
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
            <p>Supabase Auth</p>
            <h2>{mode === "login" ? "Войти в Еженедельник" : "Создать аккаунт"}</h2>
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
          Войти через Google
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
            <ChevronRight size={18} />
          </button>
        </div>
        <p className="note">Код выдает руководитель после создания команды.</p>
      </section>
    </div>
  );
}

type LeadProps = {
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
};

function LeadWorkspace(props: LeadProps) {
  const {
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
  } = props;

  return (
    <div className="workspace lead-grid">
      <section className="paper-panel team-panel">
        <div className="panel-title">
          <UsersRound />
          <div>
            <p>Команда</p>
            <h2>{team.name}</h2>
          </div>
        </div>
        <label>
          Название команды
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
          Сохранить команду
        </button>
      </section>

      <section className="paper-panel">
        <div className="panel-title">
          <FileText />
          <div>
            <p>Форма отчета</p>
            <h2>Шаблон недели</h2>
          </div>
        </div>
        <div className="segmented">
          <button
            className={team.template.mode === "structured" ? "active" : ""}
            onClick={() => updateTemplateField("mode", "structured")}
          >
            По разделам
          </button>
          <button
            className={team.template.mode === "free" ? "active" : ""}
            onClick={() => updateTemplateField("mode", "free")}
          >
            Свободный текст
          </button>
        </div>
        <label>
          Инструкция сотрудникам
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
          <input
            value={newSection}
            onChange={(event) => setNewSection(event.target.value)}
            placeholder="Новый раздел"
          />
          <button onClick={addSection}>
            <Plus size={16} />
          </button>
        </div>
      </section>

      <section className="paper-panel status-panel">
        <div className="panel-title">
          <CalendarClock />
          <div>
            <p>
              Дедлайн: {team.deadlineDay}, {team.deadlineTime}
            </p>
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
              placeholder="Комментарий для возврата на исправление"
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
          {aiBusy ? "Собираю сводку..." : "Суммаризировать отчеты"}
        </button>
        {aiError && <p className="error-line">{aiError}</p>}
        <SummaryBlock title="Главное" items={summary.highlights} />
        <SummaryBlock title="Блокеры" items={summary.blockers} />
        <SummaryBlock title="Следующие шаги" items={summary.nextSteps} />
        <SummaryBlock title="Риски" items={summary.risks} />
        <p className="summary-raw">{summary.raw}</p>
      </section>

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
    </div>
  );
}

type MemberProps = {
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
  employeeReport: WeeklyReport;
};

function MemberWorkspace(props: MemberProps) {
  const {
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
  } = props;

  return (
    <div className="workspace member-grid">
      <section className="paper-panel">
        <div className="panel-title">
          <KeyRound />
          <div>
            <p>Присоединение</p>
            <h2>Код команды</h2>
          </div>
        </div>
        <div className="add-row">
          <input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder="Например NOTE42"
          />
          <button disabled={!joinCode || busy} onClick={onJoin}>
            <ChevronRight size={18} />
          </button>
        </div>
        <p className="note">В настоящем режиме код связывает сотрудника с командой руководителя.</p>
      </section>

      <section className="paper-panel employee-brief">
        <div className="panel-title">
          <Clock3 />
          <div>
            <p>{team.name}</p>
            <h2>
              Сдать до {team.deadlineDay.toLowerCase()}, {team.deadlineTime}
            </h2>
          </div>
        </div>
        <p>{team.template.instructions}</p>
        {employeeReport.returnedComment && (
          <div className="teacher-note">
            <strong>Комментарий руководителя</strong>
            <span>{employeeReport.returnedComment}</span>
          </div>
        )}
      </section>

      <section className="paper-panel editor-panel">
        <div className="panel-title">
          <PencilLine />
          <div>
            <p>Мой отчет</p>
            <h2>Неделя {currentWeekLabel}</h2>
          </div>
        </div>
        {team.template.sections.map((section) => (
          <label key={section}>
            {section}
            <textarea
              value={draftSections[section] ?? ""}
              onChange={(event) => updateDraft(section, event.target.value)}
              rows={section === "Сделано" ? 7 : 4}
            />
          </label>
        ))}
        <div className="actions">
          <button className="secondary" onClick={improveReport} disabled={aiBusy}>
            <Bot size={17} />
            {aiBusy ? "Думаю..." : "Помочь с текстом"}
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
        <pre>{aiDraft || "Нажми «Помочь с текстом», и помощник предложит, как сделать отчет яснее для руководителя."}</pre>
      </section>
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

function SummaryBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="summary-block">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default App;
