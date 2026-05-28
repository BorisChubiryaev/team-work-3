import {
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  KeyRound,
  Mail,
  MessageSquareReply,
  PencilLine,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Table2,
  UsersRound,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { currentUser, employeeUser, initialReports, initialSummary, initialTeam } from "./data";
import type { ReportStatus, Role, Summary, Team, WeeklyReport } from "./types";

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

const weekLabel = "20-24.04";

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

  if (!response.ok) {
    throw new Error("AI endpoint is not configured yet");
  }

  return (await response.json()) as { text: string };
}

function App() {
  const [role, setRole] = useState<Role>("lead");
  const [team, setTeam] = useState<Team>(initialTeam);
  const [reports, setReports] = useState<WeeklyReport[]>(initialReports);
  const [summary, setSummary] = useState<Summary>(initialSummary);
  const [selectedReportId, setSelectedReportId] = useState(initialReports[0].id);
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
  const [aiDraft, setAiDraft] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");

  const selectedReport = reports.find((report) => report.id === selectedReportId) ?? reports[0];
  const memberReports = reports.filter((report) => report.employeeId !== currentUser.id);
  const employees = team.members.filter((member) => member.role === "member");
  const reportByEmployee = new Map(memberReports.map((report) => [report.employeeId, report]));
  const missingEmployees = employees.filter((member) => !reportByEmployee.has(member.id));

  const completion = useMemo(() => {
    const submitted = employees.length - missingEmployees.length;
    return Math.round((submitted / employees.length) * 100);
  }, [employees.length, missingEmployees.length]);

  const employeeReport =
    reports.find((report) => report.employeeId === employeeUser.id) ??
    ({
      id: "report-new",
      employeeId: employeeUser.id,
      employeeName: employeeUser.name,
      week: weekLabel,
      status: "draft",
      sections: draftSections,
    } satisfies WeeklyReport);

  function updateTemplateField(field: "instructions" | "mode", value: string) {
    setTeam((prev) => ({
      ...prev,
      template: { ...prev.template, [field]: value },
    }));
  }

  function addSection() {
    const clean = newSection.trim();
    if (!clean || team.template.sections.includes(clean)) return;
    setTeam((prev) => ({
      ...prev,
      template: {
        ...prev.template,
        sections: [...prev.template.sections, clean],
      },
    }));
    setDraftSections((prev) => ({ ...prev, [clean]: "" }));
    setNewSection("");
  }

  function updateDraft(section: string, value: string) {
    setDraftSections((prev) => ({ ...prev, [section]: value }));
  }

  function submitDraft() {
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

  function reviewReport(status: "approved" | "returned") {
    setReports((prev) =>
      prev.map((report) =>
        report.id === selectedReport.id
          ? {
              ...report,
              status,
              returnedComment: status === "returned" ? comment || "Нужны уточнения перед принятием." : undefined,
            }
          : report
      )
    );
    setComment("");
  }

  async function improveReport() {
    setAiBusy(true);
    setAiError("");
    try {
      const result = await callAi("assist", {
        template: team.template,
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
      setSummary((prev) => ({ ...prev, raw: result.text }));
    } catch {
      setAiError(
        "Суммаризация сейчас работает в демо-режиме. Для настоящих ответов добавь OPENROUTER_API_KEY в переменные окружения Vercel."
      );
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Еженедельник</p>
          <h1>Отчеты команды без ручной сводки</h1>
        </div>
        <div className="role-switch" aria-label="Выбор роли">
          <button className={role === "lead" ? "active" : ""} onClick={() => setRole("lead")}>
            <ClipboardCheck size={18} />
            Руководитель
          </button>
          <button className={role === "member" ? "active" : ""} onClick={() => setRole("member")}>
            <PencilLine size={18} />
            Сотрудник
          </button>
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

      {role === "lead" ? (
        <LeadWorkspace
          team={team}
          setTeam={setTeam}
          reports={reports}
          selectedReport={selectedReport}
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
          addSection={addSection}
          newSection={newSection}
          setNewSection={setNewSection}
          reviewReport={reviewReport}
          summarizeReports={summarizeReports}
          updateTemplateField={updateTemplateField}
        />
      ) : (
        <MemberWorkspace
          team={team}
          joinCode={joinCode}
          setJoinCode={setJoinCode}
          draftSections={draftSections}
          updateDraft={updateDraft}
          submitDraft={submitDraft}
          improveReport={improveReport}
          aiBusy={aiBusy}
          aiDraft={aiDraft}
          aiError={aiError}
          employeeReport={employeeReport}
        />
      )}
    </main>
  );
}

type LeadProps = {
  team: Team;
  setTeam: React.Dispatch<React.SetStateAction<Team>>;
  reports: WeeklyReport[];
  selectedReport: WeeklyReport;
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
  addSection: () => void;
  newSection: string;
  setNewSection: (value: string) => void;
  reviewReport: (status: "approved" | "returned") => void;
  summarizeReports: () => void;
  updateTemplateField: (field: "instructions" | "mode", value: string) => void;
};

function LeadWorkspace(props: LeadProps) {
  const {
    team,
    setTeam,
    reports,
    selectedReport,
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
    addSection,
    newSection,
    setNewSection,
    reviewReport,
    summarizeReports,
    updateTemplateField,
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
          <input value={team.name} onChange={(event) => setTeam({ ...team, name: event.target.value })} />
        </label>
        <div className="deadline-row">
          <label>
            День
            <select
              value={team.deadlineDay}
              onChange={(event) => setTeam({ ...team, deadlineDay: event.target.value })}
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
              onChange={(event) => setTeam({ ...team, deadlineTime: event.target.value })}
            />
          </label>
        </div>
        <div className="join-card">
          <span>Код для сотрудников</span>
          <strong>{team.joinCode}</strong>
          <button onClick={() => setTeam({ ...team, joinCode: createJoinCode() })}>
            <RefreshCw size={16} />
          </button>
        </div>
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
            <p>Дедлайн: {team.deadlineDay}, {team.deadlineTime}</p>
            <h2>{completion}% сдали</h2>
          </div>
        </div>
        <div className="progress"><span style={{ width: `${completion}%` }} /></div>
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
          <button className="secondary" onClick={() => reviewReport("returned")}>
            <X size={17} />
            Вернуть
          </button>
          <button onClick={() => reviewReport("approved")}>
            <Check size={17} />
            Принять
          </button>
        </div>
      </section>

      <section className="paper-panel summary-panel">
        <div className="panel-title">
          <Sparkles />
          <div>
            <p>AI-сводка</p>
            <h2>Для руководителя</h2>
          </div>
        </div>
        <button className="wide-button" onClick={summarizeReports} disabled={aiBusy}>
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
  draftSections: Record<string, string>;
  updateDraft: (section: string, value: string) => void;
  submitDraft: () => void;
  improveReport: () => void;
  aiBusy: boolean;
  aiDraft: string;
  aiError: string;
  employeeReport: WeeklyReport;
};

function MemberWorkspace(props: MemberProps) {
  const {
    team,
    joinCode,
    setJoinCode,
    draftSections,
    updateDraft,
    submitDraft,
    improveReport,
    aiBusy,
    aiDraft,
    aiError,
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
          <button>
            <ChevronRight size={18} />
          </button>
        </div>
        <p className="note">После Supabase Auth код будет связывать сотрудника с командой руководителя.</p>
      </section>

      <section className="paper-panel employee-brief">
        <div className="panel-title">
          <Clock3 />
          <div>
            <p>{team.name}</p>
            <h2>Сдать до {team.deadlineDay.toLowerCase()}, {team.deadlineTime}</h2>
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
            <h2>Неделя {weekLabel}</h2>
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
          <button onClick={submitDraft}>
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
