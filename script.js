/* ================================================================
   NIMBLY POD — application script
   Modular sections: CONFIG -> DATA -> STATE -> AUTH -> NAV -> RENDERERS -> CHARTS -> MODALS -> INIT
   ================================================================ */

/* ---------------------------------------------------------------
   0. CONFIG — paste your logo link here
   --------------------------------------------------------------- */
const CONFIG = {
  // Paste an image link (e.g. an Imgur direct-image URL) to show your real
  // company logo on the login screen, sidebar, and dashboard banner.
  // Example: "https://i.imgur.com/xxxxxxx.png"
  logoUrl: "https://i.imgur.com/aAPpqvq.png",

  // Paste your deployed Apps Script Web App URL here (ends in /exec).
  // See SETUP_INSTRUCTIONS.md. Leave blank to run on the built-in demo data.
  apiUrl: "https://script.google.com/macros/s/AKfycbzaJnGgWjJxvCdHhG0oHNwkA9FBUAtNctSBGgU4icFIsusyBkk7r06TcYFEXjSxwyJVwQ/exec",
};

/* ---------------------------------------------------------------
   0b. BACKEND API HELPERS (Google Sheet via Apps Script Web App)
   --------------------------------------------------------------- */
function apiConfigured(){ return !!CONFIG.apiUrl; }

async function apiGet(action, params){
  const url = new URL(CONFIG.apiUrl);
  url.searchParams.set("action", action);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  return res.json();
}

async function apiPost(action, payload){
  // text/plain avoids a CORS preflight request, which Apps Script web apps don't handle.
  const res = await fetch(CONFIG.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(Object.assign({ action }, payload)),
  });
  return res.json();
}

function roleLabel_(role){
  return ({ employee:"Employee", hr:"HR Staff", hrhead:"HR Head", admin:"Administrator" })[role] || "Employee";
}

function initialsFrom_(name){
  return (name || "").split(" ").filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

function fmtDate_(v){
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

function safeJSON_(str, fallback){
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

function escapeHtml_(v){
  return String(v == null ? "" : v).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]);
}

// Builds the HTML that displays an uploaded case document (image, PDF, Drive
// file...). Shared by the case review modal and the standalone popup.
function attachmentPreviewHtml_(url, name, mime, heightCss){
  const safeUrl = escapeHtml_(url);
  const safeName = escapeHtml_(name || "Attachment");
  const isDriveLink = url.includes("drive.google.com");
  const isImage = (mime || "").startsWith("image/") || /\.(png|jpe?g|gif|webp|heic)$/i.test(name || "");
  const isPdf = (mime || "") === "application/pdf" || /\.pdf$/i.test(name || "");

  if (isDriveLink) {
    // Drive's own preview endpoint renders images, PDFs, and Office docs alike.
    return `<iframe src="${safeUrl}" style="width:100%;height:${heightCss};border:0;border-radius:8px;" allow="autoplay"></iframe>`;
  }
  if (isImage) {
    return `<img src="${safeUrl}" alt="${safeName}" style="max-width:100%;max-height:${heightCss};display:block;margin:0 auto;border-radius:8px;" />`;
  }
  if (isPdf) {
    return `<iframe src="${safeUrl}" style="width:100%;height:${heightCss};border:0;border-radius:8px;"></iframe>`;
  }
  return `<div class="empty-note" style="padding:34px 16px;">This file type can't be previewed here. Use "Open in new tab" to view it.</div>`;
}

// The /preview link is for embedding; the normal viewer page is /view.
function attachmentOpenUrl_(url){
  return url.includes("drive.google.com") ? url.replace(/\/preview$/, "/view") : url;
}

// Reads a File into a plain base64 string (no "data:...;base64," prefix)
// so it can be JSON-posted to Apps Script and saved to Drive there.
function fileToBase64_(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// "Remember me" — persists just enough to skip the login form next visit.
// No password is ever stored, only the account details already returned
// by a successful login.
const REMEMBER_KEY = "nimblyRememberedSession";
const REMEMBER_CREDS_KEY = "nimblyRememberedCredentials";

function saveRememberedSession(session){
  try { localStorage.setItem(REMEMBER_KEY, JSON.stringify(session)); } catch (e) {}
}
function clearRememberedSession(){
  try { localStorage.removeItem(REMEMBER_KEY); } catch (e) {}
}
function loadRememberedSession(){
  try { return safeJSON_(localStorage.getItem(REMEMBER_KEY), null); } catch (e) { return null; }
}

// Separately, the actual email/password typed into the login form — so the
// fields themselves stay pre-filled on the login screen when "Remember me"
// is checked, the way a normal login page behaves.
function saveRememberedCreds(email, password){
  try { localStorage.setItem(REMEMBER_CREDS_KEY, JSON.stringify({ email, password })); } catch (e) {}
}
function clearRememberedCreds(){
  try { localStorage.removeItem(REMEMBER_CREDS_KEY); } catch (e) {}
}
function loadRememberedCreds(){
  try { return safeJSON_(localStorage.getItem(REMEMBER_CREDS_KEY), null); } catch (e) { return null; }
}

// Pulls live data from the Google Sheet backend into the DATA object
// that the rest of the app already renders from.
async function loadBackendData(){
  if (!apiConfigured()) return;
  const res = await apiGet("getAll");
  if (!res.ok){ toast("Couldn't load data from the sheet: " + res.error); return; }

  DATA.announcements = (res.announcements || []).map(a => ({
    id: a.ID, title: a.Title, category: a.Category, desc: a.Description,
    author: a.Author, date: fmtDate_(a.Date), priority: a.Priority || "Normal",
  })).reverse();

  DATA.appointments = (res.appointments || []).map(a => ({
    id: a.ID, employee: a.Employee, employeeEmail: a.EmployeeEmail,
    hr: a.HR, hrEmail: a.HREmail, type: a.Type, date: a.Date, time: a.Time,
    reason: a.Reason, notes: a.Notes, status: a.Status, outcome: a.Outcome,
    meetLink: a.MeetLink,
  }));

  DATA.cases = (res.cases || []).map(c => ({
    number: c.Number, employee: c.Employee, status: c.Status,
    category: c.Category, assigned: c.Assigned, description: c.Description,
    history: safeJSON_(c.HistoryJSON, []),
    attachmentUrl: "", attachmentName: "", attachmentMime: "",
  }));

  // Cases carry their attachment via a separate CaseAttachments tab (see
  // Code.gs) so match it back onto each case by case number.
  (res.caseAttachments || []).forEach(att => {
    const key = String(att.CaseNumber || "").trim();
    const c = DATA.cases.find(x => String(x.number || "").trim() === key);
    if (c && att.FileUrl) { c.attachmentUrl = att.FileUrl; c.attachmentName = att.FileName; c.attachmentMime = att.MimeType || ""; }
  });

  DATA.requests = res.requests || [];

  if (res.employees && res.employees.length){
    DATA.employees = res.employees.map(e => ({
      id: e.ID, name: e.Name, dept: e.Dept, position: e.Position,
      supervisor: e.Supervisor, status: e.Status,
    }));
  }
  if (res.archive && res.archive.length){
    DATA.archiveDocs = res.archive.map(d => ({ title: d.Title, type: d.Type, date: d.Date, by: d.By }));
  }
  if (res.backupLogs && res.backupLogs.length){
    DATA.backupLogs = res.backupLogs.map(l => ({ text: l.Text, time: l.Time }));
  }
}

/* ---------------------------------------------------------------
   1. DUMMY DATA
   --------------------------------------------------------------- */
const DATA = {
  perfKpis: [
    { label:"Avg. rating (Q3)", value:"4.2 / 5" },
    { label:"Goals on track", value:"87%" },
    { label:"Recognitions this month", value:"11" },
  ],

  users: {
    employee: { name:"Juno Dela Cruz", role:"Employee", empId:"NP-2021-0142", dept:"Employee Relations & Well-being", position:"HR Staff", initials:"JD" },
    hr:       { name:"Marisol Reyes",  role:"HR Staff",  empId:"NP-2019-0031", dept:"HR Operations, Analytics & Policy", position:"HR Generalist", initials:"MR" },
    hrhead:   { name:"Bien Santos",    role:"HR Head",   empId:"NP-2015-0008", dept:"HR Operations, Analytics & Policy", position:"Department Head", initials:"BS" },
    admin:    { name:"Admin Root",     role:"Administrator", empId:"NP-2012-0001", dept:"HR Operations, Analytics & Policy", position:"Project Manager", initials:"AR" },
  },

  vision:"To become an exceptional company in providing efficient services and a workplace that prioritizes its employees, encouraging them to grow alongside the company and beyond.",
  mission:"To bridge global businesses with agile, high-performing remote talent through cloud-driven efficiency, autonomous pod structures, and seamless workforce solutions.",

  priorities: [
    { title:"Deliver Top-Tier, Pod-Powered Talent", desc:"Recruiting, screening, and deploying highly skilled remote professionals and cross-functional Pods that align with each client's needs, work requirements, and culture." },
    { title:"Ensure Operational Excellence and Service Reliability", desc:"Organized, reliable processes that let remote teams deliver quality service to clients across different time zones." },
    { title:"Strengthening Technology, Automation, and Data Security", desc:"Modern, cloud-based tools that improve communication, teamwork, and employee management while keeping client information safe." },
    { title:"Building Lasting Partnerships, Not Just Transactions", desc:"Working alongside clients as a true strategic partner \u2014 not a staffing vendor \u2014 to streamline operations and drive long-term growth." },
    { title:"Maintaining Compliance, Ethical Standards, and Sustainable Growth", desc:"Responsible expansion that looks after our people, follows international labor and data-privacy law, and keeps ethics at the center of every market we grow into." },
  ],

  communicationsOfficerNote:"Talent postings are written and published by the Communications Officer, Talent Acquisition &amp; Workforce Planning.",

  departments: ["Talent Acquisition & Workforce Planning","Learning, Training & Development","Performance & Rewards","Employee Relations & Well-being","HR Operations, Analytics & Policy"],

  deptInfo: {
    "Talent Acquisition & Workforce Planning": { local:"Local 02", email:"talentacquisition@nimblypod.com", short:"Talent Acq." },
    "Learning, Training & Development": { local:"Local 03", email:"learninganddev@nimblypod.com", short:"L&D" },
    "Performance & Rewards": { local:"Local 04", email:"performancerewards@nimblypod.com", short:"Perf. & Rewards" },
    "Employee Relations & Well-being": { local:"Local 05", email:"erwb@nimblypod.com", short:"ER & WB" },
    "HR Operations, Analytics & Policy": { local:"Local 06", email:"hrops@nimblypod.com", short:"HR Ops" },
  },

  hrDepartments: [
    { name:"Talent Acquisition & Workforce Planning", resp:"Recruitment, selection, manpower planning, onboarding" },
    { name:"Learning, Training & Development", resp:"Training, career development, succession, competencies" },
    { name:"Performance & Rewards", resp:"Performance, compensation, incentives, recognition" },
    { name:"Employee Relations & Well-being", resp:"Conflict, discipline, engagement, workplace relations" },
    { name:"HR Operations, Analytics & Policy", resp:"HR systems, policies, records, metrics, compliance, analytics" },
  ],

  jobPositions: [
    { title:"HR Generalist", desc:"Oversees the whole HR operation and submits the weekly monitoring report to the CEO." },
    { title:"Department Head", desc:"Responsible for the final recommendation of their assigned HR division." },
    { title:"HR Analyst", desc:"Responsible for evidence and data." },
    { title:"HR Consultant", desc:"Responsible for professional interviews and external evidence." },
    { title:"Policy Specialist", desc:"Responsible for policies, legal, and ethical considerations." },
    { title:"Project Manager", desc:"Responsible for implementation." },
    { title:"Communications Officer", desc:"Responsible for presenting the proposal and publishing talent postings." },
    { title:"HR Staff", desc:"Assists and accomplishes tasks assigned by the Department Head." },
  ],

  googleSheetUrl:"https://docs.google.com/spreadsheets/d/18J1tjoRsoAgdy9nhEhekSO1jnMHTcxUa7a-QiyKUVe8/edit?usp=drivesdk",
  googleDocUrl:"https://docs.google.com/document/d/1BRt8wJbG6IZHO0YtOveitAP6LDxwrZle379iNqynEH4/edit?usp=drivesdk",

  // "supervisor" holds the employee's Department Head (label shown to users is "Department Head").
  employees: [
    { id:"NP-2020-0066", name:"Cassy Uy", dept:"Talent Acquisition & Workforce Planning", position:"Department Head", supervisor:"Rosario Viray (CEO)", status:"Active" },
    { id:"NP-2022-0087", name:"Aira Bautista", dept:"Talent Acquisition & Workforce Planning", position:"Communications Officer", supervisor:"Cassy Uy", status:"Active" },
    { id:"NP-2023-0114", name:"Miko Villareal", dept:"Talent Acquisition & Workforce Planning", position:"HR Analyst", supervisor:"Cassy Uy", status:"Probationary" },
    { id:"NP-2023-0115", name:"Renz Cabrera", dept:"Talent Acquisition & Workforce Planning", position:"Recruitment Specialist", supervisor:"Cassy Uy", status:"Active" },
    { id:"NP-2023-0116", name:"Faye Aquino", dept:"Talent Acquisition & Workforce Planning", position:"Sourcing Specialist", supervisor:"Cassy Uy", status:"Active" },
    { id:"NP-2024-0117", name:"Job Mendoza", dept:"Talent Acquisition & Workforce Planning", position:"Onboarding Coordinator", supervisor:"Cassy Uy", status:"Active" },
    { id:"NP-2024-0118", name:"Liza Ferrer", dept:"Talent Acquisition & Workforce Planning", position:"Workforce Planning Analyst", supervisor:"Cassy Uy", status:"Active" },
    { id:"NP-2024-0119", name:"Dex Salonga", dept:"Talent Acquisition & Workforce Planning", position:"Recruitment Coordinator", supervisor:"Cassy Uy", status:"Probationary" },
    { id:"NP-2025-0120", name:"Marga Ilustre", dept:"Talent Acquisition & Workforce Planning", position:"HR Consultant", supervisor:"Cassy Uy", status:"Active" },
    { id:"NP-2025-0121", name:"Owen Rivera", dept:"Talent Acquisition & Workforce Planning", position:"HR Staff", supervisor:"Cassy Uy", status:"Active" },

    { id:"NP-2021-0055", name:"Kyle Fernandez", dept:"Learning, Training & Development", position:"Department Head", supervisor:"Rosario Viray (CEO)", status:"Active" },
    { id:"NP-2018-0022", name:"Denise Ocampo", dept:"Learning, Training & Development", position:"HR Consultant", supervisor:"Kyle Fernandez", status:"On Leave" },
    { id:"NP-2023-0130", name:"Noel Trinidad", dept:"Learning, Training & Development", position:"HR Staff", supervisor:"Kyle Fernandez", status:"Active" },
    { id:"NP-2023-0131", name:"Cielo Mangubat", dept:"Learning, Training & Development", position:"Training Specialist", supervisor:"Kyle Fernandez", status:"Active" },
    { id:"NP-2024-0132", name:"Basti Domingo", dept:"Learning, Training & Development", position:"Learning Coordinator", supervisor:"Kyle Fernandez", status:"Active" },
    { id:"NP-2024-0133", name:"Rain Cortez", dept:"Learning, Training & Development", position:"Curriculum Developer", supervisor:"Kyle Fernandez", status:"Active" },
    { id:"NP-2024-0134", name:"Vince Ramos", dept:"Learning, Training & Development", position:"Competency Analyst", supervisor:"Kyle Fernandez", status:"Probationary" },
    { id:"NP-2025-0135", name:"Nadia Espino", dept:"Learning, Training & Development", position:"Training Coordinator", supervisor:"Kyle Fernandez", status:"Active" },
    { id:"NP-2025-0136", name:"Josh Tañedo", dept:"Learning, Training & Development", position:"L&D Consultant", supervisor:"Kyle Fernandez", status:"Active" },

    { id:"NP-2020-0041", name:"Patrice Lim", dept:"Performance & Rewards", position:"Department Head", supervisor:"Rosario Viray (CEO)", status:"Active" },
    { id:"NP-2017-0019", name:"Grace Manansala", dept:"Performance & Rewards", position:"HR Analyst", supervisor:"Patrice Lim", status:"Active" },
    { id:"NP-2024-0151", name:"Sam Ilagan", dept:"Performance & Rewards", position:"HR Staff", supervisor:"Patrice Lim", status:"Probationary" },
    { id:"NP-2024-0152", name:"Tricia Nolasco", dept:"Performance & Rewards", position:"Compensation Analyst", supervisor:"Patrice Lim", status:"Active" },
    { id:"NP-2024-0153", name:"Marc Bello", dept:"Performance & Rewards", position:"Rewards Coordinator", supervisor:"Patrice Lim", status:"Active" },
    { id:"NP-2025-0154", name:"Elyse Ocampo", dept:"Performance & Rewards", position:"Performance Analyst", supervisor:"Patrice Lim", status:"Active" },
    { id:"NP-2025-0155", name:"Kier Gatchalian", dept:"Performance & Rewards", position:"Benefits Specialist", supervisor:"Patrice Lim", status:"Active" },
    { id:"NP-2025-0156", name:"Bea Santiago", dept:"Performance & Rewards", position:"Evaluation Coordinator", supervisor:"Patrice Lim", status:"Active" },

    { id:"NP-2021-0142", name:"Juno Dela Cruz", dept:"Employee Relations & Well-being", position:"HR Staff", supervisor:"Rhys Abad", status:"Active" },
    { id:"NP-2022-0099", name:"Rhys Abad", dept:"Employee Relations & Well-being", position:"Department Head", supervisor:"Rosario Viray (CEO)", status:"Active" },
    { id:"NP-2023-0143", name:"Wendell Cruz", dept:"Employee Relations & Well-being", position:"Case Officer", supervisor:"Rhys Abad", status:"Active" },
    { id:"NP-2023-0144", name:"Camille Santos", dept:"Employee Relations & Well-being", position:"Mediation Specialist", supervisor:"Rhys Abad", status:"Active" },
    { id:"NP-2024-0145", name:"Ram Villafuerte", dept:"Employee Relations & Well-being", position:"Employee Engagement Officer", supervisor:"Rhys Abad", status:"Active" },
    { id:"NP-2024-0146", name:"Pia Abella", dept:"Employee Relations & Well-being", position:"Well-being Coordinator", supervisor:"Rhys Abad", status:"Probationary" },
    { id:"NP-2025-0147", name:"Erol Matias", dept:"Employee Relations & Well-being", position:"Grievance Officer", supervisor:"Rhys Abad", status:"Active" },
    { id:"NP-2025-0148", name:"Shane Buenaflor", dept:"Employee Relations & Well-being", position:"HR Staff", supervisor:"Rhys Abad", status:"Active" },
    { id:"NP-2025-0149", name:"Iggy Lacson", dept:"Employee Relations & Well-being", position:"Employee Relations Analyst", supervisor:"Rhys Abad", status:"Active" },

    { id:"NP-2015-0008", name:"Bien Santos", dept:"HR Operations, Analytics & Policy", position:"Department Head", supervisor:"Rosario Viray (CEO)", status:"Active" },
    { id:"NP-2019-0031", name:"Marisol Reyes", dept:"HR Operations, Analytics & Policy", position:"HR Generalist", supervisor:"Bien Santos", status:"Active" },
    { id:"NP-2012-0001", name:"Admin Root", dept:"HR Operations, Analytics & Policy", position:"Project Manager", supervisor:"Bien Santos", status:"Active" },
    { id:"NP-2026-0201", name:"M. Sheina", dept:"HR Operations, Analytics & Policy", position:"Policy Specialist", supervisor:"Bien Santos", status:"Active" },
    { id:"NP-2023-0202", name:"Danna Villaruel", dept:"HR Operations, Analytics & Policy", position:"HR Analyst", supervisor:"Bien Santos", status:"Active" },
    { id:"NP-2024-0203", name:"Gio Nazareno", dept:"HR Operations, Analytics & Policy", position:"Systems Administrator", supervisor:"Bien Santos", status:"Active" },
    { id:"NP-2024-0204", name:"Kath Almario", dept:"HR Operations, Analytics & Policy", position:"Compliance Officer", supervisor:"Bien Santos", status:"Active" },
    { id:"NP-2025-0205", name:"Enzo Padua", dept:"HR Operations, Analytics & Policy", position:"HR Records Officer", supervisor:"Bien Santos", status:"Active" },
    { id:"NP-2025-0206", name:"Yna Corpuz", dept:"HR Operations, Analytics & Policy", position:"Data & Analytics Specialist", supervisor:"Bien Santos", status:"Active" },
    { id:"NP-2025-0207", name:"Reo Villamor", dept:"HR Operations, Analytics & Policy", position:"HR Policy Coordinator", supervisor:"Bien Santos", status:"Active" },
  ],

  activity: [
    { text:"Aira Bautista's leave request was approved", time:"12 minutes ago" },
    { text:"New candidate advanced to Interview — Ops Associate", time:"48 minutes ago" },
    { text:"Grievance G-1042 marked Resolved", time:"2 hours ago" },
    { text:"Denise Ocampo filed a certificate of employment request", time:"Yesterday, 4:15 PM" },
    { text:"Training \u201cData Privacy Refresher\u201d completed by 18 employees", time:"Yesterday, 11:02 AM" },
  ],

  notifications: [],

  ceoAnnouncement: {
    body:"",
    sign:"",
  },

  talentKpis: {
    headcount:"", openPositions:"", criticalPositions:"", turnoverRisks:"", expenseProjection:"", productivityRatio:"",
  },

  workforcePlanning: [
    { metric:"Current Headcount", value:"" },
    { metric:"Target Headcount", value:"" },
    { metric:"Open Positions", value:"" },
    { metric:"Critical Positions", value:"" },
    { metric:"Turnover Risk", value:"" },
    { metric:"Projected Turnover", value:"" },
    { metric:"Annual Payroll", value:"" },
    { metric:"Expense Projection", value:"" },
    { metric:"Productivity Ratio", value:"" },
    { metric:"Workforce Utilization", value:"" },
  ],

  vacancies: [],

  pipelineStages: ["Application","Screening","Interview","Assessment","Selection","Offer","Onboarding"],
  pipelineCounts: [0,0,0,0,0,0,0],
  candidates: [],

  learningUpcoming: [],
  learningAssigned: [],
  learningCompleted: [],
  trainingCalendar: [],
  competencyGaps: [],
  succession: [],

  announcements: [
    { id:1, title:"Q4 Town Hall — Save the Date", category:"Company", desc:"Join the CEO and department heads for the Q4 town hall covering performance, priorities, and open forum Q&A.", author:"Rosario Viray", date:"Sep 09, 2026", priority:"High" },
    { id:2, title:"Revised Leave-Filing Cut-off", category:"Policy", desc:"Starting October 1, leave requests must be filed at least 5 working days in advance except for emergency leave.", author:"Marisol Reyes", date:"Sep 08, 2026", priority:"High" },
    { id:3, title:"Data Privacy Refresher — Register Now", category:"Training", desc:"Mandatory refresher for all employees handling customer data. Two sessions available this month.", author:"Kyle Fernandez", date:"Sep 05, 2026", priority:"Normal" },
    { id:4, title:"HR Helpdesk Hours Extended", category:"HR", desc:"The HR helpdesk is now open until 8:00 PM on weekdays to better support night-shift teams.", author:"Bien Santos", date:"Sep 03, 2026", priority:"Normal" },
    { id:5, title:"Foundation Day Celebration", category:"Events", desc:"Mark your calendars \u2014 our 12th Foundation Day celebration is happening this October with games, food, and awards.", author:"Rosario Viray", date:"Aug 29, 2026", priority:"Normal" },
    { id:6, title:"Building B Fire Drill", category:"Emergency", desc:"A scheduled fire drill will take place in Building B on September 15 at 3:00 PM. Please follow floor marshal instructions.", author:"Admin Root", date:"Aug 27, 2026", priority:"High" },
  ],

  appointments: [
    { id:"AT-501", employee:"Juno Dela Cruz", hr:"Marisol Reyes", type:"Online", date:"2026-09-12", time:"10:00 AM", reason:"Benefits consultation", status:"Accepted", notes:"", outcome:"" },
    { id:"AT-498", employee:"Denise Ocampo", hr:"Bien Santos", type:"Face-to-face", date:"2026-09-11", time:"2:30 PM", reason:"Return-to-work interview", status:"Rescheduled", notes:"Moved from Sep 9 due to HR availability.", outcome:"" },
    { id:"AT-490", employee:"Miko Villareal", hr:"Marisol Reyes", type:"Face-to-face", date:"2026-09-05", time:"9:00 AM", reason:"Probationary evaluation", status:"Completed", notes:"", outcome:"Extended probation by 30 days; performance plan issued." },
    { id:"AT-484", employee:"Rhys Abad", hr:"Kyle Fernandez", type:"Online", date:"2026-09-02", time:"4:00 PM", reason:"Equipment concern escalation", status:"Declined", notes:"Redirected to IT Support ticketing.", outcome:"" },
    { id:"AT-505", employee:"Sam Ilagan", hr:"Marisol Reyes", type:"Face-to-face", date:"2026-09-16", time:"11:00 AM", reason:"Well-being check-in", status:"Pending Review", notes:"", outcome:"" },
  ],

  cases: [
    { number:"C-1042", employee:"Aira Bautista", category:"Attendance", status:"Resolved", assigned:"Marisol Reyes",
      description:"Repeated tardiness over two pay periods; requested clarification on shifting schedule accommodations.",
      history:[ {text:"Case filed", time:"Aug 20, 2026"}, {text:"Consultation scheduled", time:"Aug 22, 2026"}, {text:"Resolved \u2014 schedule shift approved", time:"Sep 09, 2026"} ] },
    { number:"C-1051", employee:"Sam Ilagan", category:"Workplace conduct", status:"Under Review", assigned:"Bien Santos",
      description:"Reported disagreement between shift-mates escalated during a floor huddle.",
      history:[ {text:"Case filed", time:"Sep 04, 2026"}, {text:"Statements collected from both parties", time:"Sep 06, 2026"} ] },
    { number:"C-1055", employee:"Noel Trinidad", category:"Compensation dispute", status:"Open", assigned:"Marisol Reyes",
      description:"Discrepancy flagged between night-differential pay and posted schedule.",
      history:[ {text:"Case filed", time:"Sep 09, 2026"} ] },
    { number:"C-1049", employee:"Patrice Lim", category:"Well-being check-in", status:"Action Required", assigned:"Kyle Fernandez",
      description:"Self-referred check-in following extended overtime during month-end close.",
      history:[ {text:"Case filed", time:"Sep 01, 2026"}, {text:"Initial consultation completed", time:"Sep 03, 2026"}, {text:"Workload review pending manager input", time:"Sep 08, 2026"} ] },
  ],

  goals: [
    { title:"Reduce average handle time to under 6 minutes", progress:82 },
    { title:"Achieve 95% CSAT for the quarter", progress:91 },
    { title:"Complete Leadership Foundations certification", progress:70 },
    { title:"Mentor two junior CSRs to full proficiency", progress:55 },
  ],
  ratings: [
    { employee:"Juno Dela Cruz", cycle:"Q3 2026", rating:"4.6 / 5", trend:"up" },
    { employee:"Aira Bautista", cycle:"Q3 2026", rating:"4.2 / 5", trend:"up" },
    { employee:"Miko Villareal", cycle:"Q3 2026 (Probationary)", rating:"3.8 / 5", trend:"flat" },
    { employee:"Denise Ocampo", cycle:"Q2 2026", rating:"4.0 / 5", trend:"down" },
  ],
  rewards: [
    { text:"Juno Dela Cruz awarded \u201cCoach of the Quarter\u201d", time:"Sep 01, 2026" },
    { text:"Customer Support team hit 95% CSAT streak \u2014 team lunch unlocked", time:"Aug 28, 2026" },
    { text:"Aira Bautista recognized for zero-escalation month", time:"Aug 15, 2026" },
  ],

  wellbeingProcedures: [
    "Employee raises a concern to their supervisor or directly to HR.",
    "HR Staff logs the concern and assigns it a case number.",
    "HR Generalist reviews it and determines the track: mediation, investigation, or referral.",
    "Employee receives a response with next steps and an expected timeline.",
    "All procedures follow the Employee Relations & Well-being policy on file in the Archive.",
  ],
  wellbeingInitiatives: [
    "Monthly wellness check-ins for every team.",
    "Mental health first-aid webinars, run quarterly.",
    "Peer support circles facilitated by HR.",
    "Flexible time-off allowance for well-being days.",
  ],

  archiveDocs: [
    { title:"Employee Relations Policy v3.pdf", type:"Policy", date:"Aug 2026", by:"Bien Santos" },
    { title:"Engagement Survey Interview Notes.docx", type:"Interview", date:"Jul 2026", by:"Marisol Reyes" },
    { title:"Q2 Turnover Analysis Report.pdf", type:"Report", date:"Jul 2026", by:"Kyle Fernandez" },
    { title:"Grievance Handling Procedure.pdf", type:"Policy", date:"Jun 2026", by:"Bien Santos" },
    { title:"Compensation Benchmark Research.xlsx", type:"Research", date:"May 2026", by:"Patrice Lim" },
  ],

  backupHistory: [
    { date:"Sep 11, 2026 \u2014 4:00 AM", type:"Automatic", size:"1.4 GB", status:"Success" },
    { date:"Sep 10, 2026 \u2014 4:00 AM", type:"Automatic", size:"1.4 GB", status:"Success" },
    { date:"Sep 09, 2026 \u2014 6:12 PM", type:"Manual", size:"1.4 GB", status:"Success" },
    { date:"Sep 09, 2026 \u2014 4:00 AM", type:"Automatic", size:"1.3 GB", status:"Success" },
  ],
  backupLogs: [
    { text:"Admin Root updated permission set \u201cHR Staff\u201d", time:"Today, 9:14 AM" },
    { text:"System nightly sync completed without errors", time:"Today, 4:02 AM" },
    { text:"Admin Root added new department \u201cQuality Assurance\u201d", time:"Sep 09, 2026" },
  ],
};

const KPI = {
  totalEmployees: DATA.employees.length,
  pendingApprovals: DATA.appointments.filter(a=>a.status==="Pending Review").length,
  upcomingAppointments: DATA.appointments.filter(a=>a.status==="Pending Review" || a.status==="Accepted").length,
  newHires: "",
  turnover: "",
  retention: "",
  absenteeism: "",
  trainingCompletion: "",
  engagement: "",
};

/* ---------------------------------------------------------------
   2. STATE
   --------------------------------------------------------------- */
const STATE = {
  role: "employee",
  currentView: "dashboard",
  orgTab: "orgchart",
  orgChartDept: "All",
  reportingDept: "All",
  recruitTab: "talent",
  learnTab: "employee",
  annFilter: "All",
  apptTab: "list",
  wbTab: "procedures",
};

/* ---------------------------------------------------------------
   3. NAV CONFIG
   --------------------------------------------------------------- */
const NAV_MAIN = [
  { id:"dashboard",     label:"Homepage",              icon:"dashboard",     roles:"all" },
  { id:"organization",  label:"Organization",          icon:"organization",  roles:"all" },
  { id:"analytics",     label:"HR Analytics",          icon:"analytics",     roles:["hr","hrhead","admin"] },
  { id:"performance",   label:"Performance",           icon:"performance",   roles:"all" },
  { id:"recruitment",   label:"Recruitment",           icon:"recruitment",   roles:["hr","hrhead","admin"] },
  { id:"learning",      label:"Learning & Development",icon:"learning",      roles:"all" },
  { id:"announcements", label:"Announcements",         icon:"announcements", roles:"all" },
  { id:"appointments",  label:"Appointments",          icon:"appointments",  roles:"all" },
  { id:"cases",         label:"Case Board",            icon:"cases",         roles:"all" },
  { id:"wellbeing",     label:"Employee Well-Being",   icon:"wellbeing",     roles:"all" },
  { id:"profile",       label:"My Profile",            icon:"profile",       roles:"all" },
  { id:"archive",       label:"Archive",               icon:"archive",       roles:"all" },
  { id:"backup",        label:"Backup & Recovery",     icon:"backup",        roles:["admin"] },
  { id:"settings",      label:"Settings",              icon:"settings",      roles:"all" },
];

const NAV_HR = [
  { id:"recruitment",   label:"Talent Acquisition & Workforce Planning",  icon:"talent",     roles:["hr","hrhead","admin"] },
  { id:"learning",      label:"Learning, Training & Development",         icon:"ld",         roles:["hr","hrhead","admin"] },
  { id:"performance",   label:"Performance & Rewards",                    icon:"rewards",    roles:["hr","hrhead","admin"] },
  { id:"wellbeing",     label:"Employee Relations & Well-being",          icon:"relations",  roles:["hr","hrhead","admin"] },
  { id:"analytics",     label:"HR Operations, Analytics & Policy",        icon:"ops",        roles:["hr","hrhead","admin"] },
  { id:"organization",  label:"User Management",                         icon:"users",      roles:["admin"], tab:"employeedir" },
  { id:"organization",  label:"Organization Management",                 icon:"org",        roles:["admin"], tab:"orgchart" },
];

const VIEW_META = {
  dashboard:     ["Homepage", "Welcome back to your pod."],
  organization:  ["Organization", "Structure, departments, people, and roles."],
  analytics:     ["HR Analytics", "Headcount, turnover, and hiring at a glance."],
  performance:   ["Performance", "Goals, ratings, and recognition."],
  recruitment:   ["Talent Acquisition", "From workforce planning to successful hiring."],
  learning:      ["Learning & Development", "Courses, certifications, and growth."],
  announcements: ["Announcement Center", "What's happening across the company."],
  appointments:  ["Appointments", "HR consultations, scheduled and tracked."],
  cases:         ["Case Board", "Employee relations, start to resolution."],
  wellbeing:     ["Employee Well-Being", "Procedures, grievances, mediation, and support."],
  profile:       ["My Profile", "Your employment details and documents."],
  archive:       ["Archive", "Research, interviews, reports, and policy evidence."],
  backup:        ["Backup & Recovery", "System backups and administrator logs."],
  settings:      ["Settings", "Notification and account preferences."],
  help:          ["Help", "Reach the HR helpdesk."],
};

/* ---------------------------------------------------------------
   4. HELPERS
   --------------------------------------------------------------- */
function $(sel, ctx){ return (ctx||document).querySelector(sel); }
function $all(sel, ctx){ return Array.from((ctx||document).querySelectorAll(sel)); }
function el(tag, cls, html){ const e=document.createElement(tag); if(cls) e.className=cls; if(html!==undefined) e.innerHTML=html; return e; }

function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>t.classList.remove("show"), 2600);
}

function statusBadgeClass(status){
  const map = {
    "Active":"badge-green", "Completed":"badge-green", "Resolved":"badge-green", "Scheduled":"badge-blue",
    "On Leave":"badge-amber", "Ongoing":"badge-blue", "Under Review":"badge-amber", "Action Required":"badge-red",
    "Probationary":"badge-amber", "Open":"badge-red", "Cancelled":"badge-grey", "Success":"badge-green",
    "Pending Review":"badge-grey", "Accepted":"badge-amber", "Rescheduled":"badge-blue", "Declined":"badge-red",
  };
  return map[status] || "badge-grey";
}
function apptStatusIcon(status){
  const map = { "Accepted":"\uD83D\uDFE1", "Rescheduled":"\uD83D\uDD35", "Declined":"\uD83D\uDD34", "Completed":"\u2705", "Pending Review":"\u26AA", "Cancelled":"\u26AB" };
  return map[status] || "";
}

function roleAllowed(roles){ return roles === "all" || roles.includes(STATE.role); }
function isHrRole(){ return ["hr","hrhead","admin"].includes(STATE.role); }

/* ---------------------------------------------------------------
   5. LOGO
   --------------------------------------------------------------- */
function applyLogo(){
  if(!CONFIG.logoUrl) return;
  $all("img[data-logo]").forEach(img=>{
    img.src = CONFIG.logoUrl;
    img.addEventListener("load", ()=> img.classList.add("loaded"));
    img.addEventListener("error", ()=> img.classList.remove("loaded"));
  });
}

/* ---------------------------------------------------------------
   6. AUTH SCREEN LOGIC
   --------------------------------------------------------------- */
function initAuth(){
  const remembered = loadRememberedCreds();
  if (remembered) {
    $("#login-id").value = remembered.email || "";
    $("#login-pw").value = remembered.password || "";
    $("#login-remember").checked = true;
  }

  $("#show-register").addEventListener("click", e=>{ e.preventDefault(); $("#panel-login").classList.add("hidden"); $("#panel-register").classList.remove("hidden"); });
  $("#show-login").addEventListener("click", e=>{ e.preventDefault(); $("#panel-register").classList.add("hidden"); $("#panel-login").classList.remove("hidden"); });

  $("#pw-toggle").addEventListener("click", ()=>{
    const input = $("#login-pw");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    $("#pw-toggle").textContent = show ? "Hide" : "Show";
  });

  // With a real backend connected, the demo role picker just falls back
  // for accounts that don't have a Role set in the sheet yet.
  if (apiConfigured() && $("#login-role")) {
    const roleField = $("#login-role").closest(".field");
    if (roleField) roleField.querySelector("span").textContent = "Fallback role (if account has none)";
  }

  $("#login-form").addEventListener("submit", async e=>{
    e.preventDefault();
    const submitBtn = $("#login-form button[type=submit]");
    const email = $("#login-id").value.trim();
    const password = $("#login-pw").value;

    if (!apiConfigured()) {
      // No backend configured yet — keep the original demo behavior.
      STATE.role = $("#login-role").value;
      if ($("#login-remember").checked) {
        saveRememberedSession({ mode: "demo", role: STATE.role });
        saveRememberedCreds(email, password);
      } else {
        clearRememberedSession();
        clearRememberedCreds();
      }
      enterApp();
      return;
    }

    submitBtn.disabled = true; submitBtn.textContent = "Signing in\u2026";
    try {
      const res = await apiPost("login", { email, password });
      if (!res.ok) { toast(res.error || "Sign-in failed"); return; }
      const acc = res.account;
      const role = acc.Role || $("#login-role").value || "employee";
      STATE.role = role;
      DATA.users[role] = {
        name: acc.Name, role: roleLabel_(role), empId: acc.EmployeeID,
        dept: acc.Department, position: acc.Position || "", initials: initialsFrom_(acc.Name),
      };
      if ($("#login-remember").checked) {
        saveRememberedSession({ mode: "backend", role, user: DATA.users[role] });
        saveRememberedCreds(email, password);
      } else {
        clearRememberedSession();
        clearRememberedCreds();
      }
      await loadBackendData();
      enterApp();
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = "Sign in";
    }
  });

  $all("[data-next]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const step = btn.closest(".reg-step");
      if(step && !validateStep(step)) return;
      goToStep(btn.dataset.next);
    });
  });
  $all("[data-back]").forEach(btn=>{
    btn.addEventListener("click", ()=> goToStep(btn.dataset.back));
  });

  $("#register-form").addEventListener("submit", async e=>{
    e.preventDefault();
    const pw = $("#reg-pw").value, pw2 = $("#reg-pw2").value;
    if (pw !== pw2) { toast("Passwords don't match"); return; }

    if (apiConfigured()) {
      const res = await apiPost("register", {
        name: $("#reg-name").value, email: $("#reg-email").value, password: pw,
        employeeId: $("#reg-empid").value, department: $("#reg-dept").value,
      });
      if (!res.ok) { toast(res.error || "Registration failed"); return; }
    }

    toast("Account created \u2014 you can now sign in.");
    $("#login-id").value = $("#reg-email").value;
    $("#panel-register").classList.add("hidden");
    $("#panel-login").classList.remove("hidden");
    $("#register-form").reset();
    goToStep("1");
  });
}

function validateStep(stepEl){
  const inputs = $all("input[required], select[required]", stepEl);
  for(const i of inputs){ if(!i.value){ i.focus(); return false; } }
  return true;
}

function goToStep(n){
  $all(".reg-step").forEach(s=> s.classList.toggle("active", s.dataset.step === n));
  $all("#reg-steps li").forEach(li=>{
    const num = li.dataset.step;
    li.classList.toggle("active", num === n);
    li.classList.toggle("done", Number(num) < Number(n));
  });
  if(n === "3"){
    const rows = {
      "Name": $("#reg-name").value || "\u2014",
      "Department": $("#reg-dept").value,
      "Email": $("#reg-email").value || "\u2014",
      "Employee ID": $("#reg-empid").value || "\u2014",
    };
    $("#confirm-summary").innerHTML = Object.entries(rows).map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
  }
}

let SYNC_TIMER = null;

function enterApp(){
  const u = DATA.users[STATE.role];
  $("#auth-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  $("#user-name").textContent = u.name;
  $("#user-role").textContent = u.role;
  $("#user-avatar").textContent = u.initials;
  $("#profile-avatar").textContent = u.initials;
  renderSidebar();
  switchView("dashboard");
  toast(`Signed in as ${u.name}`);
  startSync();
}

// Polls the Google Sheet every few seconds so changes made by other
// signed-in users (new announcements, appointments, cases, etc.) show up
// without a page reload. Google Sheets has no native push/websocket API,
// so polling is the closest practical approximation of "real time".
function startSync(SYNC_INTERVAL_MS = 8000){
  if (!apiConfigured() || SYNC_TIMER) return;
  SYNC_TIMER = setInterval(async ()=>{
    try {
      await loadBackendData();
      renderView(STATE.currentView);
    } catch (e) { /* silent — next poll will retry */ }
  }, SYNC_INTERVAL_MS);
}

function stopSync(){
  if (SYNC_TIMER) { clearInterval(SYNC_TIMER); SYNC_TIMER = null; }
}

function logout(){
  $("#app-shell").classList.add("hidden");
  $("#auth-screen").classList.remove("hidden");
  $("#login-form").reset();
  clearRememberedSession();
  const remembered = loadRememberedCreds();
  if (remembered) {
    $("#login-id").value = remembered.email || "";
    $("#login-pw").value = remembered.password || "";
    $("#login-remember").checked = true;
  }
  closeSidebar();
  stopSync();
}

/* ---------------------------------------------------------------
   7. SIDEBAR / NAV
   --------------------------------------------------------------- */
function openSidebar(){
  $("#sidebar").classList.add("open");
  $("#sidebar-backdrop").classList.add("open");
}
function closeSidebar(){
  $("#sidebar").classList.remove("open");
  $("#sidebar-backdrop").classList.remove("open");
}

function buildNavList(container, items){
  container.innerHTML = "";
  items.filter(i=>roleAllowed(i.roles)).forEach(item=>{
    const li = el("li");
    const btn = el("button", "nav-item", `<i data-ic="${item.icon}"></i>${item.label}`);
    btn.dataset.view = item.id;
    if(item.tab) btn.dataset.tab = item.tab;
    btn.addEventListener("click", ()=>{
      switchView(item.id);
      if(item.id === "organization" && item.tab){ STATE.orgTab = item.tab; renderOrganization(); syncOrgTabs(); }
      if(window.innerWidth <= 900) closeSidebar();
    });
    li.appendChild(btn);
    container.appendChild(li);
  });
}

function renderSidebar(){
  buildNavList($("#nav-main"), NAV_MAIN);
  const hrItems = NAV_HR.filter(i=>roleAllowed(i.roles));
  $("#hr-group-label").classList.toggle("hidden", hrItems.length === 0);
  buildNavList($("#nav-hr"), NAV_HR);
  markActiveNav();
}

function markActiveNav(){
  $all(".nav-item[data-view]").forEach(b=>{
    b.classList.toggle("active", b.dataset.view === STATE.currentView && !b.dataset.tab);
  });
}

function switchView(viewId){
  STATE.currentView = viewId;
  $all(".view").forEach(v=> v.classList.add("hidden"));
  $(`#view-${viewId}`).classList.remove("hidden");
  const meta = VIEW_META[viewId] || ["", ""];
  $("#view-title").textContent = meta[0];
  $("#view-subtitle").textContent = meta[1];
  markActiveNav();
  $all(".hr-only").forEach(elm => elm.classList.toggle("hidden", !isHrRole()));
  renderView(viewId);
}

function renderView(viewId){
  const map = {
    dashboard: renderDashboard, organization: renderOrganization, analytics: renderAnalytics,
    performance: renderPerformance, recruitment: renderRecruitment, learning: renderLearning,
    announcements: renderAnnouncements, appointments: renderAppointments, cases: renderCases,
    wellbeing: renderWellbeing, profile: renderProfile, archive: renderArchive,
    backup: renderBackup, settings: renderSettings, help: ()=>{},
  };
  (map[viewId] || function(){})();
}

/* ---------------------------------------------------------------
   8. RENDER: DASHBOARD
   --------------------------------------------------------------- */
function renderDashboard(){
  const activeCases = DATA.cases.filter(c=>c.status!=="Resolved").length;
  const kpis = [
    { label:"Total employees", value:KPI.totalEmployees, delta:"+3 this month", up:true },
  ];
  // Active cases, pending approvals, and upcoming appointments are HR/CEO-only —
  // employees don't see caseload or approval-queue data on their homepage.
  if(isHrRole()){
    kpis.push(
      { label:"Active cases", value:activeCases, delta:"awaiting resolution", up:false },
      { label:"Pending approvals", value:KPI.pendingApprovals, delta:"awaiting HR Head", up:false },
      { label:"Upcoming appointments", value:KPI.upcomingAppointments, delta:"this week", up:true },
    );
  }
  $("#dash-kpis").innerHTML = kpis.map(k=>`
    <div class="kpi-card">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      <span class="kpi-delta ${k.up?'up':'down'}">${k.delta}</span>
    </div>`).join("");

  $("#dash-priorities").innerHTML = DATA.priorities.map((p,i)=>`
    <div class="priority-card">
      <span class="priority-num">0${i+1}</span>
      <strong>${p.title}</strong>
      <p>${p.desc}</p>
    </div>`).join("");

  $("#dash-ceo").innerHTML = DATA.ceoAnnouncement.body
    ? `<p>${DATA.ceoAnnouncement.body}</p><span class="ceo-sign">${DATA.ceoAnnouncement.sign}</span>`
    : `<p class="empty-note" style="padding:4px 0;">No CEO announcement posted yet.</p>`;
  $("#dash-contact").innerHTML = `<span>&#128276;</span><span>${DATA.communicationsOfficerNote}</span>`;

  $("#dash-activity").innerHTML = DATA.activity.map(a=>`
    <li><span class="dot-ic"></span><div class="act-text"><strong>${a.text}</strong><span class="act-time">${a.time}</span></div></li>`).join("") || `<li class="empty-note">No recent activity yet.</li>`;

  $("#dash-notifs").innerHTML = DATA.notifications.map(n=>`
    <li><span>${n.text}</span><span class="n-time">${n.time}</span></li>`).join("") || `<li class="empty-note">No notifications yet.</li>`;
}

/* ---------------------------------------------------------------
   9. RENDER: ORGANIZATION (5 subtabs)
   --------------------------------------------------------------- */
function renderOrganization(){
  syncOrgTabs();
  buildOrgChart();
  renderReporting();
  renderDeptDirectory();
  renderEmployeeDirectory();
  renderPositions();
  $("#dir-sheet-link").href = DATA.googleSheetUrl;
}

function syncOrgTabs(){
  $all("[data-orgtab]").forEach(t=> t.classList.toggle("active", t.dataset.orgtab === STATE.orgTab));
  ["orgchart","reporting","deptdir","employeedir","positions"].forEach(tab=>{
    $(`#org-${tab}`).classList.toggle("hidden", STATE.orgTab !== tab);
  });
}

function deptChipBar(containerId, activeVal, onPick){
  const chips = ["All", ...DATA.departments];
  $(containerId).innerHTML = chips.map(d=>`<button class="chip ${activeVal===d?'active':''}" data-deptchip="${d}">${d==="All"?"All departments":DATA.deptInfo[d].short}</button>`).join("");
  $all("[data-deptchip]", $(containerId)).forEach(chip=> chip.addEventListener("click", ()=> onPick(chip.dataset.deptchip)));
}

function buildOrgChart(){
  deptChipBar("#org-chart-deptbar", STATE.orgChartDept, (d)=>{ STATE.orgChartDept = d; buildOrgChart(); });
  const ceo = "Rosario Viray";
  const scope = STATE.orgChartDept === "All" ? DATA.employees : DATA.employees.filter(e=>e.dept===STATE.orgChartDept);
  const html = [];
  html.push(`<div class="org-row"><div class="org-node top"><strong>${ceo}</strong><span>Chief Executive Officer</span></div></div>`);
  html.push(`<div class="org-connector"></div>`);

  if(STATE.orgChartDept === "All"){
    const heads = scope.filter(e=>e.position==="Department Head");
    html.push(`<div class="org-row">` + heads.map(m=>`<div class="org-node"><strong>${m.name}</strong><span>${m.position} &middot; ${DATA.deptInfo[m.dept].short}</span></div>`).join("") + `</div>`);
    const rest = scope.filter(e=> heads.some(h=>h.name===e.supervisor));
    if(rest.length){
      html.push(`<div class="org-connector"></div>`);
      html.push(`<div class="org-row">` + rest.map(m=>`<div class="org-node"><strong>${m.name}</strong><span>${m.position}</span></div>`).join("") + `</div>`);
    }
  } else {
    const head = scope.find(e=>e.position==="Department Head");
    const rest = scope.filter(e=> e.position !== "Department Head");
    if(head) html.push(`<div class="org-row"><div class="org-node"><strong>${head.name}</strong><span>${head.position}</span></div></div>`);
    if(rest.length){
      html.push(`<div class="org-connector"></div>`);
      html.push(`<div class="org-row">` + rest.map(m=>`<div class="org-node"><strong>${m.name}</strong><span>${m.position}</span></div>`).join("") + `</div>`);
    }
  }
  $("#org-chart").innerHTML = html.join("");
}

function renderReporting(){
  deptChipBar("#org-reporting-deptbar", STATE.reportingDept, (d)=>{ STATE.reportingDept = d; renderReporting(); });
  const scope = STATE.reportingDept === "All" ? DATA.employees : DATA.employees.filter(e=>e.dept===STATE.reportingDept);
  $("#org-reporting-body").innerHTML = scope.map(e=>`
    <tr><td class="cell-name">${e.name}</td><td>${e.position}</td><td>${e.supervisor}</td></tr>`).join("");
}

function renderDeptDirectory(){
  $("#org-deptdir-body").innerHTML = DATA.hrDepartments.map(d=>`
    <tr><td class="cell-name">${d.name}</td><td>${d.resp}</td><td>${DATA.deptInfo[d.name].local}</td><td>${DATA.deptInfo[d.name].email}</td></tr>`).join("");
}

function renderEmployeeDirectory(){
  const deptSel = $("#dir-filter-dept");
  if(!deptSel.dataset.built){
    deptSel.innerHTML = `<option value="">All departments</option>` + DATA.departments.map(d=>`<option value="${d}">${DATA.deptInfo[d].short}</option>`).join("");
    deptSel.dataset.built = "1";
  }
  $("#dir-edit-note").textContent = isHrRole()
    ? "As HR, you can edit Department and Position inline below."
    : "Department and Position are managed by HR.";

  const term = ($("#dir-search").value || "").toLowerCase();
  const dept = $("#dir-filter-dept").value;
  const status = $("#dir-filter-status").value;

  const rows = DATA.employees.filter(e=>{
    const matchTerm = !term || e.name.toLowerCase().includes(term) || e.id.toLowerCase().includes(term) || e.dept.toLowerCase().includes(term);
    const matchDept = !dept || e.dept === dept;
    const matchStatus = !status || e.status === status;
    return matchTerm && matchDept && matchStatus;
  });

  const editable = isHrRole();
  $("#dir-table-body").innerHTML = rows.map(e=>`
    <tr data-emprow="${e.id}">
      <td class="cell-name">${e.name}</td>
      <td>${e.id}</td>
      <td>${editable ? `<select class="filter-select" data-editdept="${e.id}">${DATA.departments.map(d=>`<option value="${d}" ${d===e.dept?'selected':''}>${DATA.deptInfo[d].short}</option>`).join("")}</select>` : e.dept}</td>
      <td>${editable ? `<select class="filter-select" data-editpos="${e.id}">${DATA.jobPositions.map(p=>`<option value="${p.title}" ${p.title===e.position?'selected':''}>${p.title}</option>`).join("")}</select>` : e.position}</td>
      <td>${DATA.deptInfo[e.dept].local}</td>
      <td style="white-space:nowrap;">${DATA.deptInfo[e.dept].email}</td>
      <td>${e.supervisor}</td>
      <td><span class="badge ${statusBadgeClass(e.status)}">${e.status}</span></td>
    </tr>`).join("") || `<tr><td colspan="8" style="text-align:center;color:var(--ink-soft);padding:24px;">No employees match your filters.</td></tr>`;

  $all("[data-editdept]").forEach(sel=> sel.addEventListener("change", ()=>{
    const emp = DATA.employees.find(x=>x.id===sel.dataset.editdept);
    if(emp){ emp.dept = sel.value; toast(`${emp.name}'s department updated`); renderEmployeeDirectory(); }
  }));
  $all("[data-editpos]").forEach(sel=> sel.addEventListener("change", ()=>{
    const emp = DATA.employees.find(x=>x.id===sel.dataset.editpos);
    if(emp){ emp.position = sel.value; toast(`${emp.name}'s position updated`); renderEmployeeDirectory(); }
  }));
}

function renderPositions(){
  $("#org-positions-list").innerHTML = DATA.jobPositions.map(p=>`
    <div class="role-card"><strong>${p.title}</strong><p>${p.desc}</p></div>`).join("");
}

/* ---------------------------------------------------------------
   10. RENDER: ANALYTICS
   --------------------------------------------------------------- */
function renderAnalytics(){
  const editable = isHrRole();
  const anKpiKeys = [
    ["newHires","New hires (QTD)"], ["turnover","Turnover rate"], ["retention","Retention rate"],
    ["absenteeism","Absenteeism"], ["trainingCompletion","Training completion"], ["engagement","Engagement score"],
  ];
  $("#an-kpis").innerHTML = anKpiKeys.map(([key,label])=>`
    <div class="kpi-card">
      <div class="kpi-label">${label}</div>
      ${editable
        ? `<input class="kpi-value-input" data-analyticskpi="${key}" value="${KPI[key]}" placeholder="Not yet entered" />`
        : `<div class="kpi-value">${KPI[key] || "&mdash;"}</div>`}
    </div>`).join("");
  $all("[data-analyticskpi]").forEach(input=>{
    input.addEventListener("change", ()=>{ KPI[input.dataset.analyticskpi] = input.value; toast("Metric updated"); });
  });

  const deptCounts = DATA.departments.map(d=> DATA.employees.filter(e=>e.dept===d).length);
  drawBarChart("chart-headcount", DATA.departments.map(d=>DATA.deptInfo[d].short), deptCounts, "#17382A");

  const statusCounts = ["Active","On Leave","Probationary"].map(s=> DATA.employees.filter(e=>e.status===s).length);
  drawBarChart("chart-turnover", ["Active","On Leave","Probationary"], statusCounts, "#0F162A");

  const colors = ["#17382A","#1F6B45","#2F8B5B","#5CAE81","#9A6B00","#0F162A","#536860"];
  const pipelineTotal = DATA.pipelineCounts.reduce((a,b)=>a+b,0);
  if(pipelineTotal > 0){
    drawDonutChart("chart-recruit", DATA.pipelineStages, DATA.pipelineCounts, colors);
    $("#chart-recruit-legend").innerHTML = DATA.pipelineStages.map((s,i)=>`<span><i style="background:${colors[i]}"></i>${s} (${DATA.pipelineCounts[i]})</span>`).join("");
  } else {
    prepCanvas("chart-recruit");
    $("#chart-recruit-legend").innerHTML = `<span class="empty-note">No active pipeline candidates yet.</span>`;
  }

  const hasTrainingData = DATA.trainingCalendar && DATA.trainingCalendar.length > 0;
  if(hasTrainingData){
    drawBarChart("chart-training", DATA.trainingCalendar.map(s=>s.session), DATA.trainingCalendar.map(s=>s.completion), "#17382A");
  } else {
    prepCanvas("chart-training");
  }
}

/* ---------------------------------------------------------------
   11. RENDER: PERFORMANCE
   --------------------------------------------------------------- */
function renderPerformance(){
  const editable = isHrRole();
  $("#perf-kpis").innerHTML = DATA.perfKpis.map((k,i)=>`
    <div class="kpi-card">
      <div class="kpi-label">${k.label}</div>
      ${editable
        ? `<input class="kpi-value-input" data-perfkpi="${i}" value="${k.value}" />`
        : `<div class="kpi-value">${k.value}</div>`}
    </div>`).join("");

  $all("[data-perfkpi]").forEach(input=>{
    input.addEventListener("change", ()=>{
      DATA.perfKpis[input.dataset.perfkpi].value = input.value;
      toast(`${DATA.perfKpis[input.dataset.perfkpi].label} updated`);
    });
  });

  $("#perf-goals").innerHTML = DATA.goals.map(g=>`
    <div class="goal-item">
      <div class="goal-top"><strong>${g.title}</strong><span>${g.progress}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${g.progress}%"></div></div>
    </div>`).join("");

  $("#perf-rewards").innerHTML = DATA.rewards.map(r=>`
    <li><span class="dot-ic"></span><div class="act-text"><strong>${r.text}</strong><span class="act-time">${r.time}</span></div></li>`).join("");

  const trendArrow = { up:"&#8599; up", down:"&#8600; down", flat:"&#8594; steady" };
  $("#perf-ratings-body").innerHTML = DATA.ratings.map(r=>`
    <tr><td class="cell-name">${r.employee}</td><td>${r.cycle}</td><td><span class="badge badge-green">${r.rating}</span></td><td>${trendArrow[r.trend]}</td></tr>`).join("");
}

/* ---------------------------------------------------------------
   12. RENDER: RECRUITMENT (Talent Acquisition / Workforce Planning)
   --------------------------------------------------------------- */
function renderRecruitment(){
  syncRecTabs();

  const recEditable = isHrRole();
  const recKpiKeys = [
    ["headcount","Current headcount"], ["openPositions","Open positions"], ["criticalPositions","Critical positions"],
    ["turnoverRisks","Turnover risks"], ["expenseProjection","Expense projection"], ["productivityRatio","Productivity ratio"],
  ];
  $("#rec-kpis").innerHTML = recKpiKeys.map(([key,label])=>`
    <div class="kpi-card">
      <div class="kpi-label">${label}</div>
      ${recEditable
        ? `<input class="kpi-value-input" data-talentkpi="${key}" value="${DATA.talentKpis[key]}" placeholder="Not yet entered" />`
        : `<div class="kpi-value">${DATA.talentKpis[key] || "&mdash;"}</div>`}
    </div>`).join("");
  $all("[data-talentkpi]").forEach(input=>{
    input.addEventListener("change", ()=>{ DATA.talentKpis[input.dataset.talentkpi] = input.value; toast("Workforce metric updated"); });
  });

  $("#rec-contact").innerHTML = `<span>&#128172;</span><span>${DATA.communicationsOfficerNote}</span>`;

  $("#rec-vacancies-body").innerHTML = DATA.vacancies.map(v=>`
    <tr><td class="cell-name">${v.position}</td><td>${v.dept}</td><td>${v.openings}</td><td>${v.applicants}</td><td>${v.target}</td></tr>`).join("")
    || `<tr><td colspan="5" class="empty-note">No open vacancies posted yet.</td></tr>`;

  renderKanbanRecruitment();

  $("#rec-workforce-body").innerHTML = DATA.workforcePlanning.map(m=>`
    <tr><td class="cell-name">${m.metric}</td><td>${recEditable ? `<input class="kpi-value-input" style="font-size:13px;padding:5px 8px;" data-wfmetric="${m.metric}" value="${m.value}" placeholder="Not yet entered" />` : (m.value || "&mdash;")}</td></tr>`).join("");
  $all("[data-wfmetric]").forEach(input=>{
    input.addEventListener("change", ()=>{
      const row = DATA.workforcePlanning.find(m=>m.metric===input.dataset.wfmetric);
      if(row){ row.value = input.value; toast("Workforce metric updated"); }
    });
  });
}

function syncRecTabs(){
  $all("[data-rectab]").forEach(t=> t.classList.toggle("active", t.dataset.rectab === STATE.recruitTab));
  $("#rec-talent").classList.toggle("hidden", STATE.recruitTab !== "talent");
  $("#rec-workforce").classList.toggle("hidden", STATE.recruitTab !== "workforce");
}

function renderKanbanRecruitment(){
  const wrap = $("#rec-kanban");
  wrap.innerHTML = DATA.pipelineStages.map((stage,i)=>{
    const cards = DATA.candidates.filter(c=>c.stage===i);
    const officialCount = DATA.pipelineCounts[i];
    const extra = officialCount - cards.length;
    return `<div class="kan-col">
      <div class="kan-col-head"><h4>${stage}</h4><span class="kan-count">${officialCount}</span></div>
      ${cards.map(c=>`
        <div class="kan-card">
          <strong>${c.name}</strong>
          <div class="kan-meta">${c.position} &middot; ${c.id}</div>
          ${i < DATA.pipelineStages.length-1 ? `<button class="kan-advance" data-advance="${c.id}">Advance &rarr;</button>` : `<span class="badge badge-green">Onboarding</span>`}
        </div>`).join("")}
    </div>`;
  }).join("");

  $all("[data-advance]", wrap).forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const cand = DATA.candidates.find(c=>c.id===btn.dataset.advance);
      if(cand && cand.stage < DATA.pipelineStages.length-1){
        cand.stage++;
        toast(`${cand.name} moved to ${DATA.pipelineStages[cand.stage]}`);
        renderKanbanRecruitment();
      }
    });
  });
}

/* ---------------------------------------------------------------
   13. RENDER: LEARNING & DEVELOPMENT
   --------------------------------------------------------------- */
function renderLearning(){
  $all("[data-learntab]").forEach(t=> t.classList.toggle("active", t.dataset.learntab === STATE.learnTab));
  $("#learn-employee").classList.toggle("hidden", STATE.learnTab !== "employee");
  $("#learn-hr").classList.toggle("hidden", STATE.learnTab !== "hr");

  $("#learn-upcoming").innerHTML = DATA.learningUpcoming.map(u=>`
    <li><span class="dot-ic"></span><div class="act-text"><strong>${u.text}</strong><span class="act-time">${u.time}</span></div></li>`).join("");

  $("#learn-assigned").innerHTML = DATA.learningAssigned.map(c=>`
    <div class="goal-item">
      <div class="goal-top"><strong>${c.title}</strong><span>${c.progress}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${c.progress}%"></div></div>
    </div>`).join("");

  $("#learn-completed-body").innerHTML = DATA.learningCompleted.map(c=>`
    <tr><td class="cell-name">${c.title}</td><td>${c.date}</td><td>${c.score}</td><td><span class="badge badge-green">${c.status}</span></td></tr>`).join("");

  $("#learn-hr-kpis").innerHTML = [
    { label:"Sessions this month", value:"6" },
    { label:"Avg. completion rate", value:KPI.trainingCompletion },
    { label:"Competency gaps flagged", value: DATA.competencyGaps.length },
  ].map(k=>`<div class="kpi-card"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div></div>`).join("");

  $("#learn-calendar-body").innerHTML = DATA.trainingCalendar.map(s=>`
    <tr><td class="cell-name">${s.session}</td><td>${s.facilitator}</td><td>${s.date}</td><td>${s.attendance}</td><td>${s.completion}%</td></tr>`).join("");

  $("#learn-gaps").innerHTML = DATA.competencyGaps.map(g=>`
    <div class="goal-item">
      <div class="goal-top"><strong>${g.title}</strong><span>${g.progress}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${g.progress}%"></div></div>
    </div>`).join("");

  $("#learn-succession").innerHTML = DATA.succession.map(s=>`
    <li><span class="dot-ic"></span><div class="act-text"><strong>${s.text}</strong><span class="act-time">${s.time}</span></div></li>`).join("");
}

/* ---------------------------------------------------------------
   14. RENDER: ANNOUNCEMENTS
   --------------------------------------------------------------- */
function renderAnnouncements(){
  const cats = ["All","Company","HR","Training","Policy","Events","Emergency"];
  $("#ann-filters").innerHTML = cats.map(c=>`<button class="chip ${STATE.annFilter===c?'active':''}" data-cat="${c}">${c}</button>`).join("");
  $all("[data-cat]").forEach(chip=> chip.addEventListener("click", ()=>{ STATE.annFilter = chip.dataset.cat; renderAnnouncements(); }));

  const list = DATA.announcements.filter(a=> STATE.annFilter==="All" || a.category===STATE.annFilter);
  $("#ann-grid").innerHTML = list.map(a=>`
    <div class="ann-card" data-ann="${a.id}">
      <div class="ann-top"><span class="badge badge-green">${a.category}</span>${a.priority==="High" ? '<span class="badge badge-red">High priority</span>' : ''}</div>
      <h4>${a.title}</h4>
      <p>${a.desc.slice(0,90)}${a.desc.length>90 ? '\u2026' : ''}</p>
      <div class="ann-meta">${a.author} &middot; ${a.date}</div>
    </div>`).join("") || `<p style="color:var(--ink-soft);">No announcements in this category yet.</p>`;

  $all("[data-ann]").forEach(card=> card.addEventListener("click", ()=> openAnnouncement(Number(card.dataset.ann))));
}

function openAnnouncement(id){
  const a = DATA.announcements.find(x=>x.id===id);
  if(!a) return;
  $("#ann-modal-title").textContent = a.title;
  $("#ann-modal-body").innerHTML = `
    <div class="ann-top" style="margin-bottom:12px;"><span class="badge badge-green">${a.category}</span>${a.priority==="High" ? '<span class="badge badge-red">High priority</span>' : ''}</div>
    <p style="line-height:1.6;margin-bottom:14px;">${a.desc}</p>
    <p style="font-size:12.5px;color:var(--ink-soft);">Posted by ${a.author} on ${a.date}</p>`;
  openModal("modal-announcement");
}

/* ---------------------------------------------------------------
   15. RENDER: APPOINTMENTS (list / calendar)
   --------------------------------------------------------------- */
function renderAppointments(){
  syncApptTabs();
  const status = $("#appt-filter-status").value;
  const rows = DATA.appointments.filter(a=> !status || a.status === status);

  $("#appt-table-body").innerHTML = rows.map(a=>`
    <tr data-apptrow="${a.id}" style="cursor:pointer;">
      <td class="cell-name">${a.employee}</td>
      <td>${a.hr}</td>
      <td>${a.type}</td>
      <td>${a.date}</td>
      <td>${a.time}</td>
      <td>${a.reason}</td>
      <td><span class="badge ${statusBadgeClass(a.status)}">${apptStatusIcon(a.status)} ${a.status}</span></td>
      <td>${isHrRole() && a.status==="Pending Review" ? `
        <button class="link-btn" data-quickaccept="${a.id}">Accept</button>` : ""}</td>
    </tr>`).join("") || `<tr><td colspan="8" style="text-align:center;color:var(--ink-soft);padding:24px;">No appointments match this filter.</td></tr>`;

  $all("[data-apptrow]").forEach(row=> row.addEventListener("click", (e)=>{
    if(e.target.closest("[data-quickaccept]")) return;
    openApptDetail(row.dataset.apptrow);
  }));
  $all("[data-quickaccept]").forEach(btn=> btn.addEventListener("click", e=>{
    e.stopPropagation();
    setApptStatus(btn.dataset.quickaccept, "Accepted");
  }));

  renderApptCalendar();
}

function syncApptTabs(){
  $all("[data-appttab]").forEach(t=> t.classList.toggle("active", t.dataset.appttab === STATE.apptTab));
  $("#appt-list-wrap").classList.toggle("hidden", STATE.apptTab !== "list");
  $("#appt-cal-wrap").classList.toggle("hidden", STATE.apptTab !== "calendar");
}

function renderApptCalendar(){
  const year = 2026, month = 8; // September (0-indexed)
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const byDate = {};
  DATA.appointments.forEach(a=>{ (byDate[a.date] = byDate[a.date] || []).push(a); });

  const dows = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  let html = dows.map(d=>`<div class="cal-dow">${d}</div>`).join("");
  for(let i=0;i<firstDow;i++) html += `<div class="cal-cell empty"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const iso = `2026-09-${String(d).padStart(2,"0")}`;
    const items = byDate[iso] || [];
    html += `<div class="cal-cell"><span class="cal-date">${d}</span>${items.map(a=>`<span class="cal-appt">${a.time} ${a.employee.split(" ")[0]}</span>`).join("")}</div>`;
  }
  $("#cal-grid").innerHTML = html;
}

function setApptStatus(id, status){
  const a = DATA.appointments.find(x=>x.id===id);
  if(!a) return;
  a.status = status;
  DATA.activity.unshift({ text:`Appointment ${id} (${a.employee}) marked ${status}`, time:"Just now" });
  toast(`Appointment ${status}`);
  renderAppointments();
}

function openApptDetail(id){
  const a = DATA.appointments.find(x=>x.id===id);
  if(!a) return;
  $("#appt-modal-title").textContent = `Appointment ${a.id}`;
  $("#appt-modal-body").innerHTML = `
    <div class="case-detail-grid">
      <div><dt>Employee</dt><dd>${a.employee}</dd></div>
      <div><dt>HR representative</dt><dd>${a.hr}</dd></div>
      <div><dt>Type</dt><dd>${a.type}</dd></div>
      <div><dt>Date &amp; time</dt><dd>${a.date} &middot; ${a.time}</dd></div>
      <div style="grid-column:1/-1;"><dt>Status</dt><dd><span class="badge ${statusBadgeClass(a.status)}">${apptStatusIcon(a.status)} ${a.status}</span></dd></div>
    </div>
    <p style="font-size:13.5px;margin-bottom:14px;"><strong>Reason:</strong> ${a.reason}</p>
    <label class="field"><span>Notes</span><textarea id="appt-detail-notes" rows="3">${a.notes||""}</textarea></label>
    <label class="field"><span>Outcome</span><textarea id="appt-detail-outcome" rows="3" placeholder="Record what happened during the appointment&hellip;">${a.outcome||""}</textarea></label>
    <button type="button" class="btn btn-ghost btn-sm" id="appt-upload-btn">Upload document</button>
    <div class="case-actions-row">
      ${isHrRole() && a.status==="Pending Review" ? `
        <button class="btn btn-ghost btn-sm" data-setstatus="Accepted">&#128993; Accept</button>
        <button class="btn btn-ghost btn-sm" data-setstatus="Rescheduled">&#128309; Reschedule</button>
        <button class="btn btn-ghost btn-sm" data-setstatus="Declined">&#128308; Decline</button>` : ""}
      ${a.status !== "Cancelled" && a.status !== "Completed" ? `<button class="btn btn-ghost btn-sm" data-setstatus="Cancelled">Cancel</button>` : ""}
      <button class="btn btn-primary btn-sm" id="appt-save-btn">Save notes</button>
    </div>`;

  $("#appt-upload-btn").addEventListener("click", ()=> toast("Document attached to this appointment"));
  $all("[data-setstatus]").forEach(btn=> btn.addEventListener("click", ()=>{
    setApptStatus(a.id, btn.dataset.setstatus);
    closeModals();
  }));
  $("#appt-save-btn").addEventListener("click", ()=>{
    a.notes = $("#appt-detail-notes").value;
    a.outcome = $("#appt-detail-outcome").value;
    toast("Appointment notes saved");
    closeModals();
  });

  openModal("modal-appt-detail");
}

/* ---------------------------------------------------------------
   16. RENDER: CASE BOARD
   --------------------------------------------------------------- */
const CASE_STAGES = ["Open","Under Review","Action Required","Resolved"];
const CASE_PROCESS = [
  "CEO announces / employee reports a concern",
  "HR Staff receives it",
  "HR Generalist reviews & creates the case",
  "\uD83D\uDD34 OPEN",
  "HR Staff schedules meeting/mediation",
  "HR Consultant handles the intervention",
  "HR Analyst documents the case",
  "Department Head recommends action",
  "HR Conference",
  "CEO makes the final decision",
  "Project Manager implements it",
  "\uD83D\uDFE2 RESOLVED",
];

function renderCases(){
  $("#case-process-flow").innerHTML = CASE_PROCESS.map((s,i)=>{
    const cls = s.includes("OPEN") ? "hot" : s.includes("RESOLVED") ? "done" : "";
    return `<span class="step-chip ${cls}">${s}</span>` + (i < CASE_PROCESS.length-1 ? `<span class="step-arrow">&rarr;</span>` : "");
  }).join("");

  const term = ($("#case-search").value || "").toLowerCase();
  const wrap = $("#case-kanban");
  wrap.innerHTML = CASE_STAGES.map(stage=>{
    const cards = DATA.cases.filter(c=> c.status===stage && (!term || c.number.toLowerCase().includes(term) || c.employee.toLowerCase().includes(term)));
    return `<div class="kan-col">
      <div class="kan-col-head"><h4>${stage}</h4><span class="kan-count">${cards.length}</span></div>
      ${cards.map(c=>`
        <div class="kan-card" data-case="${c.number}">
          <strong>${c.number}</strong>
          <p style="font-size:12.5px;color:#6b7280;margin:4px 0 0;line-height:1.4;">${(c.description||"").slice(0,70)}${(c.description||"").length>70?"…":""}</p>
          <div class="kan-meta">${c.employee} &middot; ${c.category || "Uncategorized"}${c.attachmentUrl ? " &middot; 📎" : ""}</div>
          <span class="badge ${statusBadgeClass(c.status)}">${c.assigned}</span>
        </div>`).join("")}
    </div>`;
  }).join("");

  $all("[data-case]", wrap).forEach(card=> card.addEventListener("click", ()=> openCase(card.dataset.case)));
}

function openCase(number){
  const c = DATA.cases.find(x=>x.number===number);
  if(!c) return;
  $("#case-modal-title").textContent = `Case ${c.number}`;
  const nextIdx = CASE_STAGES.indexOf(c.status) + 1;
  const nextStage = CASE_STAGES[nextIdx];

  // The uploaded document opens right inside the case review, so HR can read
  // it while deciding what to do with the case.
  const attachmentHtml = c.attachmentUrl ? `
    <div class="case-attachment">
      <div class="case-attachment-head">
        <strong>📎 ${escapeHtml_(c.attachmentName || "Attachment")}</strong>
        <span class="case-attachment-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="toggle-case-attachment">Hide</button>
          <a class="btn btn-ghost btn-sm" href="${escapeHtml_(attachmentOpenUrl_(c.attachmentUrl))}" target="_blank" rel="noopener noreferrer">Open in new tab &#8599;</a>
        </span>
      </div>
      <div class="case-attachment-preview" id="case-attachment-preview">${attachmentPreviewHtml_(c.attachmentUrl, c.attachmentName, c.attachmentMime, "50vh")}</div>
    </div>` : `<p class="case-attachment-empty">No attachment on this case.</p>`;
  $("#case-modal-body").innerHTML = `
    <div class="case-detail-grid">
      <div><dt>Employee</dt><dd>${c.employee}</dd></div>
      <div><dt>Assigned HR</dt><dd>${c.assigned}</dd></div>
      <div><dt>Category</dt><dd>${c.category || "Uncategorized"}</dd></div>
      <div style="grid-column:1/-1;"><dt>Status</dt><dd><span class="badge ${statusBadgeClass(c.status)}">${c.status}</span></dd></div>
    </div>
    <p style="line-height:1.6;font-size:13.8px;">${c.description}</p>
    ${attachmentHtml}
    <ul class="case-history">${c.history.map(h=>`<li><span class="dot-ic"></span><div class="act-text"><strong>${h.text}</strong><span class="act-time">${h.time}</span></div></li>`).join("")}</ul>
    <div class="case-actions-row">
      ${["Consultation","Interview","Mediation","Policy Review"].map(a=>`<button class="btn btn-ghost btn-sm" data-caseaction="${a}">${a}</button>`).join("")}
      ${nextStage ? `<button class="btn btn-primary btn-sm" data-advancecase="${nextStage}">Move to ${nextStage}</button>` : ""}
    </div>`;

  const toggleBtn = $("#toggle-case-attachment");
  if (toggleBtn) toggleBtn.addEventListener("click", ()=>{
    const pane = $("#case-attachment-preview");
    const hidden = pane.classList.toggle("hidden");
    toggleBtn.textContent = hidden ? "Show" : "Hide";
  });

  $all("[data-caseaction]").forEach(btn=> btn.addEventListener("click", ()=>{
    c.history.push({ text:`${btn.dataset.caseaction} logged`, time:"Just now" });
    toast(`${btn.dataset.caseaction} logged for ${c.number}`);
    openCase(number);
  }));
  const advBtn = $("[data-advancecase]");
  if(advBtn) advBtn.addEventListener("click", async ()=>{
    const newStatus = advBtn.dataset.advancecase;
    const historyEntry = { text:`Status changed to ${newStatus}`, time:"Just now" };
    advBtn.disabled = true;

    if (apiConfigured()){
      const res = await apiPost("updateCase", {
        number: c.number,
        status: newStatus,
        historyEntry: historyEntry,
      });
      if (!res.ok){
        toast("Couldn't save that move: " + res.error);
        advBtn.disabled = false;
        return;
      }
    }

    c.status = newStatus;
    c.history.push(historyEntry);
    toast(`${c.number} moved to ${c.status}`);
    closeModals();
    renderCases();
  });

  openModal("modal-case");
}

/* ---------------------------------------------------------------
   17. RENDER: EMPLOYEE WELL-BEING
   --------------------------------------------------------------- */
function renderWellbeing(){
  $all("[data-wbtab]").forEach(t=> t.classList.toggle("active", t.dataset.wbtab === STATE.wbTab));
  ["procedures","grievance","conflict","wellbeing","engagement"].forEach(tab=>{
    $(`#wb-${tab}`).classList.toggle("hidden", STATE.wbTab !== tab);
  });
  $("#wb-procedures-list").innerHTML = DATA.wellbeingProcedures.map(p=>`<li>${p}</li>`).join("");
  $("#wb-initiatives-list").innerHTML = DATA.wellbeingInitiatives.map(p=>`<li>${p}</li>`).join("");
}

/* ---------------------------------------------------------------
   18. RENDER: PROFILE
   --------------------------------------------------------------- */
function renderProfile(){
  const u = DATA.users[STATE.role];
  const emp = DATA.employees.find(e=>e.id===u.empId) || {};
  $("#profile-name").textContent = u.name;
  $("#profile-role-line").textContent = `${u.dept} \u00b7 ${u.position}`;
  $("#profile-status").textContent = emp.status || "Active";
  $("#profile-status").className = "badge " + statusBadgeClass(emp.status || "Active");
  $("#profile-avatar").textContent = u.initials;

  $("#profile-details").innerHTML = `
    <div><dt>Employee ID</dt><dd>${u.empId}</dd></div>
    <div><dt>Department</dt><dd>${u.dept}</dd></div>
    <div><dt>Position</dt><dd>${u.position}</dd></div>
    <div><dt>Department Head</dt><dd>${(emp.supervisor)||"Bien Santos"}</dd></div>
    <div><dt>Employment type</dt><dd>Regular</dd></div>
    <div><dt>Date hired</dt><dd>August 29, 2026</dd></div>`;

  $("#profile-sheet-link").href = DATA.googleSheetUrl;
  $("#profile-edit-btn").onclick = ()=> toast("Profile editing would open here in the full system.");
}

/* ---------------------------------------------------------------
   19. RENDER: ARCHIVE
   --------------------------------------------------------------- */
function renderArchive(){
  $("#archive-doc-link").href = DATA.googleDocUrl;
  const term = ($("#archive-search").value || "").toLowerCase();
  const rows = DATA.archiveDocs.filter(d=> !term || d.title.toLowerCase().includes(term) || d.type.toLowerCase().includes(term));
  $("#archive-list").innerHTML = rows.map(d=>`
    <div class="archive-row">
      <div class="archive-icon">${d.type.slice(0,2).toUpperCase()}</div>
      <div class="archive-meta"><strong>${d.title}</strong><span>${d.type} &middot; uploaded by ${d.by} &middot; ${d.date}</span></div>
      <span class="badge badge-green">${d.type}</span>
    </div>`).join("") || `<p style="color:var(--ink-soft);">No documents match your search.</p>`;
}

/* ---------------------------------------------------------------
   20. RENDER: BACKUP
   --------------------------------------------------------------- */
function renderBackup(){
  $("#backup-history-body").innerHTML = DATA.backupHistory.map(b=>`
    <tr><td>${b.date}</td><td>${b.type}</td><td>${b.size}</td><td><span class="badge ${statusBadgeClass(b.status)}">${b.status}</span></td></tr>`).join("");
  $("#backup-logs").innerHTML = DATA.backupLogs.map(l=>`
    <li><span class="dot-ic"></span><div class="act-text"><strong>${l.text}</strong><span class="act-time">${l.time}</span></div></li>`).join("");
}

/* ---------------------------------------------------------------
   21. RENDER: SETTINGS
   --------------------------------------------------------------- */
function renderSettings(){
  const u = DATA.users[STATE.role];
  $("#settings-name").value = u.name;
  $("#settings-email").value = `${u.name.toLowerCase().replace(/\s+/g,'.')}@nimblypod.com`;
}

/* ---------------------------------------------------------------
   22. CANVAS CHARTS (dependency-free)
   --------------------------------------------------------------- */
function prepCanvas(id){
  const canvas = document.getElementById(id);
  const parent = canvas.parentElement;
  const style = getComputedStyle(parent);
  const padL = parseFloat(style.paddingLeft) || 0;
  const padR = parseFloat(style.paddingRight) || 0;
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(60, parent.clientWidth - padL - padR - 2);
  const cssH = window.innerWidth <= 480 ? 180 : 220;
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.style.maxWidth = "100%";
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return { ctx, w:cssW, h:cssH };
}

function drawBarChart(id, labels, values, color){
  const { ctx, w, h } = prepCanvas(id);
  ctx.clearRect(0,0,w,h);
  const padL = 30, padB = 26, padT = 14, padR = 10;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const max = Math.max(...values) * 1.2;
  const barW = plotW / values.length * 0.55;
  const gap = plotW / values.length;

  ctx.strokeStyle = "#CCEBDC"; ctx.lineWidth = 1;
  for(let i=0;i<=3;i++){
    const y = padT + plotH - (plotH*i/3);
    ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(w-padR,y); ctx.stroke();
  }
  values.forEach((v,i)=>{
    const x = padL + gap*i + (gap-barW)/2;
    const barH = (v/max)*plotH;
    const y = padT + plotH - barH;
    const r = 5;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y+r);
    ctx.arc(x+r, y+r, r, Math.PI, 1.5*Math.PI);
    ctx.arc(x+barW-r, y+r, r, 1.5*Math.PI, 2*Math.PI);
    ctx.lineTo(x+barW, y+barH);
    ctx.lineTo(x, y+barH);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#536860";
    ctx.font = "11px 'Public Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(labels[i], x+barW/2, h-8);
    ctx.fillStyle = "#101A15";
    ctx.font = "600 11px 'Public Sans', sans-serif";
    ctx.fillText(v, x+barW/2, y-6);
  });
}

function drawLineChart(id, labels, series){
  const { ctx, w, h } = prepCanvas(id);
  ctx.clearRect(0,0,w,h);
  const padL = 32, padB = 26, padT = 14, padR = 14;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const allVals = series.flatMap(s=>s.values);
  const max = Math.max(...allVals) * 1.15, min = Math.min(...allVals) * 0.85;
  const stepX = plotW / (labels.length-1);

  ctx.strokeStyle = "#CCEBDC"; ctx.lineWidth = 1;
  for(let i=0;i<=3;i++){
    const y = padT + plotH - (plotH*i/3);
    ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(w-padR,y); ctx.stroke();
  }
  ctx.fillStyle = "#536860"; ctx.font = "11px 'Public Sans', sans-serif"; ctx.textAlign="center";
  labels.forEach((l,i)=> ctx.fillText(l, padL + stepX*i, h-8));

  series.forEach(s=>{
    ctx.strokeStyle = s.color; ctx.lineWidth = 2.4; ctx.beginPath();
    s.values.forEach((v,i)=>{
      const x = padL + stepX*i;
      const y = padT + plotH - ((v-min)/(max-min))*plotH;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
    s.values.forEach((v,i)=>{
      const x = padL + stepX*i;
      const y = padT + plotH - ((v-min)/(max-min))*plotH;
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
    });
  });

  const lx = w - padR - 120;
  series.forEach((s,i)=>{
    const ly = padT + i*16;
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#536860"; ctx.textAlign = "left"; ctx.font = "11px 'Public Sans', sans-serif";
    ctx.fillText(s.name, lx+9, ly+4);
  });
}

function drawDonutChart(id, labels, values, colors){
  const { ctx, w, h } = prepCanvas(id);
  ctx.clearRect(0,0,w,h);
  const cx = w/2, cy = h/2, rOuter = Math.min(w,h)/2 - 10, rInner = rOuter*0.6;
  const total = values.reduce((a,b)=>a+b,0) || 1;
  let angle = -Math.PI/2;
  values.forEach((v,i)=>{
    const slice = (v/total) * Math.PI*2;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,rOuter, angle, angle+slice);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    angle += slice;
  });
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath(); ctx.arc(cx,cy,rInner,0,Math.PI*2); ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#101A15"; ctx.textAlign = "center"; ctx.font = "600 15px 'Fraunces', serif";
  ctx.fillText(total, cx, cy+5);
  ctx.font = "10px 'Public Sans', sans-serif"; ctx.fillStyle = "#536860";
  ctx.fillText("candidates", cx, cy+19);
}

/* ---------------------------------------------------------------
   23. MODALS
   --------------------------------------------------------------- */
function openModal(id){
  closeModals();
  $("#modal-overlay").classList.remove("hidden");
  $("#"+id).classList.add("open");
}
function closeModals(){
  $("#modal-overlay").classList.add("hidden");
  $all(".modal").forEach(m=>m.classList.remove("open"));
  const attBody = $("#case-attachment-body");
  if (attBody) attBody.innerHTML = ""; // stop any preview from loading in the background
}

// Shows an uploaded case document in a popup, without leaving the page or
// reloading anything else. Close it with the × / Cancel like any modal.
// Picks a preview that actually renders for the file type, and always
// includes a plain "open" link so the file is reachable even if the
// inline preview can't load (e.g. an org's Drive sharing policy, or a
// file type the browser can't preview inline).
function openCaseAttachment(url, name, mime){
  $("#case-attachment-title").textContent = name || "Attachment";
  const body = $("#case-attachment-body");

  if (!url){ body.innerHTML = "<p>No attachment on file.</p>"; openModal("modal-case-attachment"); return; }

  body.innerHTML = `
    ${attachmentPreviewHtml_(url, name, mime, "65vh")}
    <div style="margin-top:12px;display:flex;justify-content:flex-end;">
      <a class="btn btn-ghost btn-sm" href="${escapeHtml_(attachmentOpenUrl_(url))}" target="_blank" rel="noopener noreferrer">Open in new tab &#8599;</a>
    </div>`;
  openModal("modal-case-attachment");
}

function initModals(){
  $("#modal-overlay").addEventListener("click", e=>{ if(e.target.id==="modal-overlay") closeModals(); });
  $all("[data-close]").forEach(b=> b.addEventListener("click", closeModals));

  $("#new-request-btn").addEventListener("click", ()=> openRequestModal());
  $("#request-form").addEventListener("submit", e=>{
    e.preventDefault();
    const type = $("#req-type").value;
    DATA.activity.unshift({ text:`New request submitted: ${type}`, time:"Just now" });
    toast("Request submitted to HR");
    closeModals();
    $("#request-form").reset();
    if(STATE.currentView === "dashboard") renderDashboard();
  });

  $("#appt-new-btn").addEventListener("click", ()=> openModal("modal-appointment"));
  $("#appointment-form").addEventListener("submit", async e=>{
    e.preventDefault();
    const type = $("#appt-type").value;
    const payload = {
      employee: DATA.users[STATE.role].name,
      employeeEmail: DATA.users[STATE.role].email || "",
      hr: $("#appt-hr").value, type,
      date: $("#appt-date").value || "", time: $("#appt-time").value || "",
      reason: $("#appt-reason").value, notes: $("#appt-notes").value || "",
    };

    if (apiConfigured()) {
      const res = await apiPost("addAppointment", payload);
      if (!res.ok) { toast(res.error || "Couldn't submit appointment"); return; }
      const a = res.appointment;
      DATA.appointments.unshift({
        id: a.ID, employee: a.Employee, hr: a.HR, type: a.Type, date: a.Date || "TBD",
        time: a.Time || "TBD", reason: a.Reason, status: a.Status, notes: a.Notes,
        outcome: a.Outcome, meetLink: a.MeetLink,
      });
      toast(a.MeetLink
        ? "Appointment sent \u2014 Google Meet link created and calendar invite sent"
        : "Appointment request sent to HR for review");
    } else {
      const id = "AT-" + (500 + DATA.appointments.length + 1);
      DATA.appointments.unshift({
        id, employee: payload.employee, hr: payload.hr, type,
        date: payload.date || "TBD", time: payload.time || "TBD",
        reason: payload.reason, status:"Pending Review", notes: payload.notes, outcome:"",
      });
      toast("Appointment request sent to HR for review");
    }

    closeModals();
    $("#appointment-form").reset();
    if(STATE.currentView === "appointments") renderAppointments();
  });

  $("#case-new-btn").addEventListener("click", ()=> openModal("modal-case-new"));

  $("#case-attachment").addEventListener("change", ()=>{
    const f = $("#case-attachment").files[0];
    $("#case-attachment-name").textContent = f ? f.name : "";
  });

  $("#case-new-form").addEventListener("submit", async e=>{
    e.preventDefault();
    const file = $("#case-attachment").files[0];
    const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8MB — keep sheet/Apps Script requests small
    if (file && file.size > MAX_ATTACHMENT_BYTES) {
      toast("That file is too big — please attach something under 8MB");
      return;
    }

    const payload = {
      employee: DATA.users[STATE.role].name,
      category: $("#case-category").value, description: $("#case-desc").value,
    };
    if (file) {
      payload.attachmentName = file.name;
      payload.attachmentMime = file.type || "application/octet-stream";
      payload.attachmentData = await fileToBase64_(file);
    }

    if (apiConfigured()) {
      const res = await apiPost("addCase", payload);
      if (!res.ok) { toast(res.error || "Couldn't file case"); return; }
      const c = res.case;
      DATA.cases.unshift({
        number: c.Number, employee: c.Employee, status: c.Status,
        category: c.Category, assigned: c.Assigned, description: c.Description,
        history: safeJSON_(c.HistoryJSON, []),
        attachmentUrl: res.attachmentUrl || "", attachmentName: res.attachmentName || "",
        attachmentMime: payload.attachmentMime || "",
      });
      if (file && res.attachmentError) {
        toast(`Case ${c.Number} filed, but the attachment wasn't saved: ${res.attachmentError}`);
      } else if (file && !res.attachmentUrl) {
        toast(`Case ${c.Number} filed, but the backend didn't save the attachment. Redeploy your Apps Script (Deploy > Manage deployments > Edit > New version).`);
      } else {
        toast(`Case ${c.Number} filed`);
      }
    } else {
      const number = "C-" + (1055 + DATA.cases.length + 1);
      DATA.cases.unshift({
        number, employee: payload.employee,
        status:"Open", category: payload.category, assigned:"Marisol Reyes",
        description: payload.description, history:[{text:"Case filed", time:"Just now"}],
        // no backend configured — attachment only lasts for this browser session
        attachmentUrl: file ? URL.createObjectURL(file) : "", attachmentName: file ? file.name : "",
        attachmentMime: file ? (file.type || "application/octet-stream") : "",
      });
      toast(`Case ${number} filed`);
    }

    closeModals();
    $("#case-new-form").reset();
    $("#case-attachment-name").textContent = "";
    if(STATE.currentView === "cases") renderCases();
  });

  $("#ann-new-btn").addEventListener("click", ()=> openModal("modal-ann-new"));
  $("#ann-new-form").addEventListener("submit", async e=>{
    e.preventDefault();
    const payload = {
      title: $("#ann-title").value, category: $("#ann-category").value,
      desc: $("#ann-desc").value, author: DATA.users[STATE.role].name,
      priority: $("#ann-priority").value === "High" ? "High" : "Normal",
    };

    if (apiConfigured()) {
      const res = await apiPost("addAnnouncement", payload);
      if (!res.ok) { toast(res.error || "Couldn't post announcement"); return; }
      const a = res.announcement;
      DATA.announcements.unshift({
        id: a.ID, title: a.Title, category: a.Category, desc: a.Description,
        author: a.Author, date: fmtDate_(a.Date), priority: a.Priority || "Normal",
      });
    } else {
      const id = Math.max(0, ...DATA.announcements.map(a=>a.id)) + 1;
      DATA.announcements.unshift({ id, date:"Just now", ...payload });
    }

    toast("Announcement posted");
    closeModals();
    $("#ann-new-form").reset();
    if(STATE.currentView === "announcements") renderAnnouncements();
  });

  $("#engagement-form").addEventListener("submit", e=>{
    e.preventDefault();
    DATA.activity.unshift({ text:`Employee engagement feedback submitted by ${DATA.users[STATE.role].name}`, time:"Just now" });
    toast("Thanks — your feedback was sent to HR");
    $("#engagement-form").reset();
  });
}

function openRequestModal(presetType){
  if(presetType) $("#req-type").value = presetType;
  openModal("modal-request");
}

/* ---------------------------------------------------------------
   24. MISC WIRING
   --------------------------------------------------------------- */
function initChrome(){
  $("#logout-btn").addEventListener("click", logout);
  $("#hamburger").addEventListener("click", ()=>{
    if($("#sidebar").classList.contains("open")) closeSidebar(); else openSidebar();
  });
  $("#sidebar-close").addEventListener("click", closeSidebar);
  $("#sidebar-backdrop").addEventListener("click", closeSidebar);
  $("#notif-btn").addEventListener("click", ()=> toast(`You have ${DATA.notifications.length} notifications`));

  $all("[data-orgtab]").forEach(t=> t.addEventListener("click", ()=>{ STATE.orgTab = t.dataset.orgtab; renderOrganization(); }));
  $("#dir-search").addEventListener("input", renderEmployeeDirectory);
  $("#dir-filter-dept").addEventListener("change", renderEmployeeDirectory);
  $("#dir-filter-status").addEventListener("change", renderEmployeeDirectory);

  $all("[data-rectab]").forEach(t=> t.addEventListener("click", ()=>{ STATE.recruitTab = t.dataset.rectab; renderRecruitment(); }));
  $all("[data-learntab]").forEach(t=> t.addEventListener("click", ()=>{ STATE.learnTab = t.dataset.learntab; renderLearning(); }));
  $all("[data-appttab]").forEach(t=> t.addEventListener("click", ()=>{ STATE.apptTab = t.dataset.appttab; renderAppointments(); }));
  $all("[data-wbtab]").forEach(t=> t.addEventListener("click", ()=>{ STATE.wbTab = t.dataset.wbtab; renderWellbeing(); }));

  $("#appt-filter-status").addEventListener("change", renderAppointments);
  $("#case-search").addEventListener("input", renderCases);
  $("#archive-search").addEventListener("input", renderArchive);

  $("#wb-grievance-btn").addEventListener("click", ()=>{ $("#case-category").value = "Grievance"; openModal("modal-case-new"); });
  $("#wb-conflict-btn").addEventListener("click", ()=>{ $("#appt-reason").value = "Conflict mediation request"; openModal("modal-appointment"); });
  $("#wb-wellbeing-btn").addEventListener("click", ()=> openRequestModal("Well-being support"));
  $("#archive-upload-btn").addEventListener("click", ()=> toast("Document uploaded to the Archive"));

  $("#btn-sync").addEventListener("click", ()=> toast("Sync started \u2014 records are up to date"));
  $("#btn-backup").addEventListener("click", ()=>{
    DATA.backupHistory.unshift({ date:"Just now", type:"Manual", size:"1.4 GB", status:"Success" });
    $("#backup-last").textContent = "Just now";
    toast("Backup completed successfully");
    renderBackup();
  });
  $("#btn-restore").addEventListener("click", ()=> toast("Restore initiated from latest backup"));
  $("#btn-download").addEventListener("click", ()=> toast("Preparing backup archive for download\u2026"));

  $("#settings-save").addEventListener("click", ()=> toast("Settings saved"));

  window.addEventListener("resize", ()=>{
    if(STATE.currentView === "analytics") renderAnalytics();
  });
}

/* ---------------------------------------------------------------
   25. INIT
   --------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async ()=>{
  applyLogo();
  initAuth();
  initModals();
  initChrome();

  const remembered = loadRememberedSession();
  if (remembered) {
    STATE.role = remembered.role;
    if (remembered.mode === "backend") {
      DATA.users[remembered.role] = remembered.user;
      if (apiConfigured()) {
        try { await loadBackendData(); } catch (e) { /* fall through with cached data */ }
      }
    }
    enterApp();
  }
});
