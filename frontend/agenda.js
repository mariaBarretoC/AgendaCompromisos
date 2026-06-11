const API = "https://agendacompromisos.onrender.com";

// ---- Configuración del calendario ----
const SLOTS = [];
for (let h = 8; h <= 17; h++) {
  SLOTS.push(`${String(h).padStart(2,"0")}:00`);
  if (h < 17) SLOTS.push(`${String(h).padStart(2,"0")}:30`);
}
// SLOTS = ["08:00","08:30","09:00",...,"17:00"]

const DAYS = [
  { num: 1, label: "LUNES" },
  { num: 2, label: "MARTES" },
  { num: 3, label: "MIÉRCOLES" },
  { num: 4, label: "JUEVES" },
  { num: 5, label: "VIERNES" },
  { num: 6, label: "SÁBADO" },
];

const COLORS = [
  { val: "#fbbf24", label: "Ámbar"    },
  { val: "#00929E", label: "Teal"     },
  { val: "#34d399", label: "Verde"    },
  { val: "#60a5fa", label: "Azul"     },
  { val: "#f87171", label: "Rojo"     },
  { val: "#a78bfa", label: "Violeta"  },
  { val: "#94a3b8", label: "Gris"     },
];

// ---- DOM ----
const tbody        = document.getElementById("ag-tbody");
const dlg          = document.getElementById("dlg-reunion");
const dlgTitle     = document.getElementById("dlg-title");
const fTitulo      = document.getElementById("f-titulo");
const fDia         = document.getElementById("f-dia");
const fInicio      = document.getElementById("f-inicio");
const fFin         = document.getElementById("f-fin");
const editId       = document.getElementById("edit-id");
const colorOpts    = document.getElementById("color-opts");
const btnNueva     = document.getElementById("btn-nueva");
const btnDlgClose  = document.getElementById("btn-dlg-close");
const btnDlgCancel = document.getElementById("btn-dlg-cancel");
const btnDlgSave   = document.getElementById("btn-dlg-save");

// ---- Poblar selects de hora ----
function fillTimeSelects() {
  [fInicio, fFin].forEach(sel => {
    sel.innerHTML = "";
    SLOTS.forEach(s => {
      const o = document.createElement("option");
      o.value = s;
      o.textContent = s;
      sel.appendChild(o);
    });
  });
}

// ---- Poblar opciones de color ----
function buildColorOpts(selected = "#fbbf24") {
  colorOpts.innerHTML = "";
  COLORS.forEach(c => {
    const lbl = document.createElement("label");
    lbl.title = c.label;
    lbl.style.background = c.val;
    const inp = document.createElement("input");
    inp.type = "radio";
    inp.name = "color";
    inp.value = c.val;
    inp.checked = c.val === selected;
    lbl.appendChild(inp);
    colorOpts.appendChild(lbl);
  });
}

// ---- API helpers ----
async function apiGet(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function apiPut(path, body) {
  const r = await fetch(API + path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function apiDelete(path) {
  const r = await fetch(API + path, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ---- Calcular texto de color oscuro ----
function darkText(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return (r*299 + g*587 + b*114) / 1000 > 140 ? "#422800" : "#ffffff";
}

// ---- Construir y renderizar la grilla ----
function renderCalendar(meetings) {
  // Construir grid[dia][slotIndex] = {meeting, rowspan} | "skip" | null
  const grid = {};
  DAYS.forEach(d => { grid[d.num] = new Array(SLOTS.length).fill(null); });

  meetings.forEach(m => {
    const startIdx = SLOTS.indexOf(m.hora_inicio);
    const endIdx   = SLOTS.indexOf(m.hora_fin);
    if (startIdx === -1 || endIdx <= startIdx) return;
    const rowspan = endIdx - startIdx;
    grid[m.dia][startIdx] = { meeting: m, rowspan };
    for (let i = startIdx + 1; i < endIdx; i++) {
      grid[m.dia][i] = "skip";
    }
  });

  tbody.innerHTML = "";

  SLOTS.forEach((slot, si) => {
    const tr = document.createElement("tr");

    // Columna hora
    const th = document.createElement("th");
    th.className = "col-hora";
    th.textContent = slot;
    tr.appendChild(th);

    DAYS.forEach(d => {
      const cell = grid[d.num][si];
      if (cell === "skip") return;

      const td = document.createElement("td");

      if (cell && cell.meeting) {
        const m = cell.meeting;
        td.className = "ag-meeting";
        td.rowSpan = cell.rowspan;
        td.style.background  = m.color;
        td.style.borderColor = m.color;

        const txt = document.createElement("div");
        txt.className = "meeting-text";
        txt.style.color = darkText(m.color);
        txt.textContent = m.titulo;
        td.appendChild(txt);

        const delBtn = document.createElement("button");
        delBtn.className = "meeting-del";
        delBtn.title = "Eliminar";
        delBtn.textContent = "✕";
        delBtn.addEventListener("click", async e => {
          e.stopPropagation();
          if (!confirm(`¿Eliminar "${m.titulo}"?`)) return;
          await apiDelete(`/reuniones/${m.id}`);
          await cargar();
        });
        td.appendChild(delBtn);

        td.addEventListener("click", () => abrirEditar(m));
      } else {
        td.className = "ag-cell";
        td.addEventListener("click", () => abrirNueva(d.num, slot));
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

// ---- Cargar reuniones ----
async function cargar() {
  try {
    const meetings = await apiGet("/reuniones");
    renderCalendar(meetings);
  } catch (e) {
    console.error(e);
    alert("❌ No se pudieron cargar las reuniones");
  }
}

// ---- Abrir modal nueva ----
function abrirNueva(dia = 1, horaInicio = "08:00") {
  editId.value = "";
  dlgTitle.textContent = "Nueva reunión";
  fTitulo.value = "";
  fDia.value = String(dia);
  fInicio.value = horaInicio;
  const nextIdx = Math.min(SLOTS.indexOf(horaInicio) + 2, SLOTS.length - 1);
  fFin.value = SLOTS[nextIdx];
  buildColorOpts("#fbbf24");
  dlg.showModal();
}

// ---- Abrir modal editar ----
function abrirEditar(m) {
  editId.value = m.id;
  dlgTitle.textContent = "Editar reunión";
  fTitulo.value = m.titulo;
  fDia.value = String(m.dia);
  fInicio.value = m.hora_inicio;
  fFin.value = m.hora_fin;
  buildColorOpts(m.color);
  dlg.showModal();
}

// ---- Guardar reunión ----
btnDlgSave.addEventListener("click", async () => {
  const titulo     = fTitulo.value.trim();
  const dia        = Number(fDia.value);
  const hora_inicio = fInicio.value;
  const hora_fin   = fFin.value;
  const color      = document.querySelector('input[name="color"]:checked')?.value || "#fbbf24";

  if (!titulo) return alert("Escribe el título de la reunión");
  if (SLOTS.indexOf(hora_fin) <= SLOTS.indexOf(hora_inicio))
    return alert("La hora de fin debe ser posterior a la hora de inicio");

  try {
    const id = editId.value;
    if (id) {
      await apiPut(`/reuniones/${id}`, { titulo, dia, hora_inicio, hora_fin, color });
    } else {
      await apiPost("/reuniones", { titulo, dia, hora_inicio, hora_fin, color });
    }
    dlg.close();
    await cargar();
  } catch (e) {
    alert("❌ Error guardando: " + e.message);
  }
});

btnDlgClose.addEventListener("click",  () => dlg.close());
btnDlgCancel.addEventListener("click", () => dlg.close());
btnNueva.addEventListener("click",     () => abrirNueva());

// ---- Init ----
fillTimeSelects();
cargar();
