const API = "https://agendacompromisos.onrender.com";

// =======================
// DOM — Filtros / Toolbar
// =======================
const btnRecargar              = document.getElementById("btn-recargar");
const tbody                    = document.getElementById("tbody-compromisos");
const chkTodos                 = document.getElementById("chk-todos");
const btnExportar              = document.getElementById("btn-exportar");
const btnEliminarSeleccionados = document.getElementById("btn-eliminar-seleccionados");

const filtroContrato    = document.getElementById("filtro_contrato");
const filtroResponsable = document.getElementById("filtro_responsable");
const filtroAtrasado    = document.getElementById("filtro_atrasado");
const dateField         = document.getElementById("date_field");
const dateMode          = document.getElementById("date_mode");
const dateValue         = document.getElementById("date_value");
const btnFiltrar        = document.getElementById("btn-filtrar");
const btnLimpiar        = document.getElementById("btn-limpiar");

// =======================
// DOM — Modal Nuevo compromiso
// =======================
const btnNuevo           = document.getElementById("btn-nuevo");
const dlgNuevo           = document.getElementById("dlg-nuevo");
const btnCancelNuevo     = document.getElementById("btn-cancel-nuevo");
const btnCancelNuevoForm = document.getElementById("btn-cancel-nuevo-form");
const formCompromiso     = document.getElementById("form-compromiso");
const fContratoId        = document.getElementById("f-contrato-id");
const fResponsable       = document.getElementById("f-responsable");
const fFechaEntrega      = document.getElementById("f-fecha-entrega");
const fCompromiso        = document.getElementById("f-compromiso");
const fObservacion       = document.getElementById("f-observacion");

// =======================
// DOM — Modales existentes
// =======================
const dlgHistorial       = document.getElementById("dlg-historial");
const historialBody      = document.getElementById("historial-body");
const btnCerrarHistorial = document.getElementById("btn-cerrar-historial");

const dlgObs        = document.getElementById("dlg-observacion");
const obsInfo       = document.getElementById("obs-info");
const obsModo       = document.getElementById("obs-modo");
const obsTexto      = document.getElementById("obs-texto");
const obsActual     = document.getElementById("obs-actual");
const btnCancelObs  = document.getElementById("btn-cancel-obs");
const btnGuardarObs = document.getElementById("btn-guardar-obs");

const fileEvidencia = document.getElementById("file-evidencia");

// =======================
// Estado
// =======================
let selectedId              = null;
let selectedObsActual       = "";
let selectedEvidenciaCompId = null;

// =======================
// Helpers
// =======================
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function toDateInputValue(dateStr) {
  return dateStr ? String(dateStr).slice(0,10) : "";
}
function getSelectedEstados() {
  return [...document.querySelectorAll(".chk-estado:checked")].map(c => c.value);
}
function estadoBadge(estado) {
  if (estado === "Pendiente")    return `<span class="badge badge--pendiente">Pendiente</span>`;
  if (estado === "Reprogramado") return `<span class="badge badge--reprog">Reprogramado</span>`;
  if (estado === "Cerrado")      return `<span class="badge badge--cerrado">Cerrado</span>`;
  return `<span class="badge">${escapeHtml(estado)}</span>`;
}
function syncDateInputType() {
  dateValue.type = dateMode.value === "month" ? "month" : "date";
}

// =======================
// HTTP helpers
// =======================
async function apiGet(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiPost(path, body) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiPatch(path, body) {
  const res = await fetch(API + path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiDelete(path) {
  const res = await fetch(API + path, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// =======================
// Contratos
// =======================
async function cargarContratos() {
  const contratos = await apiGet("/contratos");
  filtroContrato.innerHTML = `<option value="">(Todos)</option>`;
  fContratoId.innerHTML    = `<option value="">— Selecciona —</option>`;
  contratos.forEach(c => {
    const o1 = document.createElement("option");
    o1.value = c.id; o1.textContent = c.nombre;
    filtroContrato.appendChild(o1);
    const o2 = document.createElement("option");
    o2.value = c.id; o2.textContent = c.nombre;
    fContratoId.appendChild(o2);
  });
  // Opción para crear contrato nuevo en el modal
  const optNew = document.createElement("option");
  optNew.value = "__nuevo__";
  optNew.textContent = "+ Crear nuevo contrato...";
  fContratoId.appendChild(optNew);
}

// Widget crear contrato (modal Nuevo compromiso)
const fNuevoContratoRow    = document.getElementById("f-nuevo-contrato-row");
const fNuevoContratoNombre = document.getElementById("f-nuevo-contrato-nombre");
const fBtnCrearContrato    = document.getElementById("f-btn-crear-contrato");
const fBtnCancelarContrato = document.getElementById("f-btn-cancelar-contrato");

fContratoId.addEventListener("change", () => {
  if (fContratoId.value === "__nuevo__") {
    fNuevoContratoRow.style.display = "flex";
    fNuevoContratoNombre.value = "";
    fNuevoContratoNombre.focus();
  } else {
    fNuevoContratoRow.style.display = "none";
  }
});

fBtnCrearContrato.addEventListener("click", async () => {
  const nombre = fNuevoContratoNombre.value.trim();
  if (!nombre) return alert("Escribe el nombre del contrato");
  try {
    const nuevo = await apiPost("/contratos", { nombre });
    await cargarContratos();
    fContratoId.value = nuevo.id;
    fNuevoContratoRow.style.display = "none";
  } catch (err) {
    alert("❌ Error creando contrato: " + err.message);
  }
});

fBtnCancelarContrato.addEventListener("click", () => {
  fNuevoContratoRow.style.display = "none";
  fContratoId.value = "";
});

// =======================
// Filtros
// =======================
function buildQueryFromFilters() {
  const params = new URLSearchParams();
  if (filtroContrato.value) params.set("contrato_id", filtroContrato.value);
  getSelectedEstados().forEach(e => params.append("estado", e));
  const resp = filtroResponsable.value.trim();
  if (resp) params.set("responsable", resp);
  if (filtroAtrasado.value !== "") params.set("atrasado", filtroAtrasado.value);
  if (dateField.value && dateValue.value) {
    params.set("date_field", dateField.value);
    params.set("date_mode",  dateMode.value);
    params.set("date_value", dateValue.value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// =======================
// KPIs
// =======================
function actualizarKPIs(lista) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("kpi-total",     lista.length);
  set("kpi-pendiente", lista.filter(c => c.estado === "Pendiente").length);
  set("kpi-reprog",    lista.filter(c => c.estado === "Reprogramado").length);
  set("kpi-cerrado",   lista.filter(c => c.estado === "Cerrado").length);
  set("kpi-atrasado",  lista.filter(c => Number(c.atrasado) === 1).length);
}

async function cargarStats(query = "") {
  try {
    const s   = await apiGet("/compromisos/stats" + query);
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = Number(val ?? 0); };
    set("kpi-total",     s.total);
    set("kpi-pendiente", s.pendiente);
    set("kpi-reprog",    s.reprogramado);
    set("kpi-cerrado",   s.cerrado);
    set("kpi-atrasado",  s.atrasado);
  } catch (e) { console.error("Stats error:", e.message); }
}

// =======================
// Tabla
// =======================
function evidenciaCell(c) {
  const tiene = Number(c.tiene_evidencia ?? 0) === 1;
  if (!tiene) return `<span class="hint">Sin evidencia</span>`;
  return `
    <div class="actions">
      <button class="iconbtn" type="button" title="Ver"       data-action="evi_ver"  data-id="${c.id}">👁</button>
      <button class="iconbtn" type="button" title="Descargar" data-action="evi_down" data-id="${c.id}">⬇</button>
      <button class="iconbtn" type="button" title="Eliminar"  data-action="evi_del"  data-id="${c.id}">🗑</button>
    </div>`;
}

async function cargarCompromisos(query = "") {
  const compromisos = await apiGet("/compromisos" + query);
  actualizarKPIs(compromisos);
  tbody.innerHTML = "";
  compromisos.forEach(c => {
    const tr = document.createElement("tr");
    if (Number(c.atrasado) === 1) tr.classList.add("row-late");
    const obs = c.observacion_general || "";
    const obsPreview = obs.length > 60 ? obs.slice(0,60) + "..." : obs;
    tr.innerHTML = `
      <td class="col-check"><input type="checkbox" class="chk-compromiso" data-id="${c.id}"></td>
      <td>${escapeHtml(c.contrato)}</td>
      <td>${escapeHtml(c.responsable)}</td>
      <td>${escapeHtml(c.compromiso)}</td>
      <td>${escapeHtml(toDateInputValue(c.fecha_creacion))}</td>
      <td>${escapeHtml(toDateInputValue(c.fecha_entrega))}</td>
      <td>${estadoBadge(c.estado)}</td>
      <td>${Number(c.cantidad_reprogramaciones || 0)}</td>
      <td>${escapeHtml(toDateInputValue(c.fecha_entrega_compromiso))}</td>
      <td>${Number(c.atrasado) === 1 ? "Sí" : "No"}</td>
      <td title="${escapeHtml(obs)}">${escapeHtml(obsPreview)}</td>
      <td>
        <div class="actions">
          <button class="iconbtn" type="button" title="Subir evidencia" data-action="evi_up" data-id="${c.id}">⬆</button>
        </div>
        ${evidenciaCell(c)}
      </td>
      <td class="col-actions">
        <div class="actions">
          <button class="iconbtn" type="button" title="Observación" data-action="observacion" data-id="${c.id}" data-obs="${encodeURIComponent(obs)}">📝</button>
          <button class="iconbtn" type="button" title="Historial"   data-action="historial"   data-id="${c.id}">🕓</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });
}

// =======================
// Modal Nuevo Compromiso
// =======================
btnNuevo.addEventListener("click", () => {
  formCompromiso.reset();
  dlgNuevo.showModal();
});
btnCancelNuevo.addEventListener("click",     () => dlgNuevo.close());
btnCancelNuevoForm.addEventListener("click", () => dlgNuevo.close());

formCompromiso.addEventListener("submit", async e => {
  e.preventDefault();
  const body = {
    contrato_id:         Number(fContratoId.value),
    responsable:         fResponsable.value.trim(),
    compromiso:          fCompromiso.value.trim(),
    fecha_entrega:       fFechaEntrega.value,
    observacion_general: fObservacion.value.trim(),
  };
  if (!body.contrato_id) return alert("Selecciona un contrato");
  try {
    await apiPost("/compromisos", body);
    alert("✅ Compromiso creado");
    formCompromiso.reset();
    dlgNuevo.close();
    await cargarCompromisos(buildQueryFromFilters());
  } catch (err) {
    console.error(err);
    alert("❌ Error creando compromiso: " + err.message);
  }
});

// =======================
// Exportar
// =======================
btnExportar.addEventListener("click", () => {
  window.open(`${API}/compromisos/export${buildQueryFromFilters()}`, "_blank");
});

// =======================
// Filtros — eventos
// =======================
dateMode.addEventListener("change", syncDateInputType);

btnFiltrar.addEventListener("click", async () => {
  const q = buildQueryFromFilters();
  await Promise.all([cargarCompromisos(q), cargarStats(q)]);
});

btnLimpiar.addEventListener("click", async () => {
  filtroContrato.value    = "";
  filtroResponsable.value = "";
  filtroAtrasado.value    = "";
  document.querySelectorAll(".chk-estado").forEach(c => c.checked = false);
  dateField.value = "";
  dateMode.value  = "day";
  syncDateInputType();
  dateValue.value = "";
  await cargarCompromisos("");
});

btnRecargar.addEventListener("click", () => {
  const q = buildQueryFromFilters();
  Promise.all([cargarCompromisos(q), cargarStats(q)]);
});

// =======================
// Seleccionar todos
// =======================
chkTodos.addEventListener("change", () => {
  document.querySelectorAll(".chk-compromiso").forEach(c => c.checked = chkTodos.checked);
});

// =======================
// Eliminar seleccionados
// =======================
btnEliminarSeleccionados.addEventListener("click", async () => {
  const ids = [...document.querySelectorAll(".chk-compromiso:checked")]
    .map(x => Number(x.dataset.id)).filter(Number.isFinite);
  if (!ids.length) return alert("Selecciona al menos 1 compromiso.");
  if (!confirm(`¿Eliminar ${ids.length} compromiso(s)?`)) return;
  try {
    const res = await apiPost("/compromisos/delete-bulk", { ids });
    alert(`✅ Eliminados: ${res.deleted_count}`);
    chkTodos.checked = false;
    await cargarCompromisos(buildQueryFromFilters());
  } catch (err) {
    console.error(err);
    alert("❌ Error: " + err.message);
  }
});

// =======================
// Evidencia
// =======================
function abrirSelectorEvidencia(compromisoId) {
  selectedEvidenciaCompId = compromisoId;
  fileEvidencia.value = "";
  fileEvidencia.click();
}

fileEvidencia.addEventListener("change", async () => {
  const file = fileEvidencia.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) { alert("❌ Debe ser una imagen."); return; }
  if (!confirm("¿Subir esta evidencia?")) return;
  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API}/compromisos/${selectedEvidenciaCompId}/evidencia`, {
      method: "POST", body: formData,
    });
    if (!res.ok) throw new Error(await res.text());
    alert("✅ Evidencia subida");
    await cargarCompromisos(buildQueryFromFilters());
  } catch (err) {
    console.error(err);
    alert("❌ Error: " + err.message);
  } finally { selectedEvidenciaCompId = null; }
});

// =======================
// Acciones de tabla
// =======================
tbody.addEventListener("click", async e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id     = Number(btn.dataset.id);
  const action = btn.dataset.action;

  if (action === "evi_up")   return abrirSelectorEvidencia(id);
  if (action === "evi_ver")  return window.open(`${API}/compromisos/${id}/evidencia/view`,     "_blank");
  if (action === "evi_down") return window.open(`${API}/compromisos/${id}/evidencia/download`, "_blank");

  if (action === "evi_del") {
    if (!confirm("¿Eliminar la evidencia?")) return;
    try {
      await apiDelete(`/compromisos/${id}/evidencia`);
      alert("✅ Eliminada");
      await cargarCompromisos(buildQueryFromFilters());
    } catch (err) { alert("❌ " + err.message); }
    return;
  }

  if (action === "historial") {
    selectedId = id;
    const hist = await apiGet(`/compromisos/${id}/historial`);
    historialBody.innerHTML = !hist.length
      ? "<div class='hint'>No hay reprogramaciones.</div>"
      : `<table style="width:100%;border-collapse:collapse;margin-top:10px;">
          <thead><tr>
            <th style="border:1px solid #ddd;padding:8px;">Anterior</th>
            <th style="border:1px solid #ddd;padding:8px;">Nueva</th>
            <th style="border:1px solid #ddd;padding:8px;">Fecha cambio</th>
          </tr></thead>
          <tbody>${hist.map(h => `<tr>
            <td style="border:1px solid #ddd;padding:8px;">${escapeHtml(toDateInputValue(h.fecha_anterior))}</td>
            <td style="border:1px solid #ddd;padding:8px;">${escapeHtml(toDateInputValue(h.nueva_fecha))}</td>
            <td style="border:1px solid #ddd;padding:8px;">${escapeHtml(String(h.fecha_reprogramacion).replace("T"," ").slice(0,19))}</td>
          </tr>`).join("")}</tbody>
        </table>`;
    dlgHistorial.showModal();
    return;
  }

  if (action === "observacion") {
    selectedId = id;
    const obs = decodeURIComponent(btn.dataset.obs || "");
    selectedObsActual = obs;
    obsInfo.textContent = `Compromiso ID: ${id}`;
    obsTexto.value  = "";
    obsModo.value   = "append";
    obsActual.value = selectedObsActual || "";
    dlgObs.showModal();
    return;
  }
});

// =======================
// Modales existentes
// =======================
btnCerrarHistorial.addEventListener("click", () => dlgHistorial.close());

btnCancelObs.addEventListener("click", () => dlgObs.close());
btnGuardarObs.addEventListener("click", async () => {
  const texto = obsTexto.value.trim();
  const modo  = obsModo.value;
  if (!texto) return alert("Escribe la observación");
  try {
    const updated = await apiPatch(`/compromisos/${selectedId}/observacion`, { texto, modo });
    selectedObsActual   = updated.observacion_general || "";
    obsActual.value = selectedObsActual;
    obsTexto.value  = "";
    await cargarCompromisos(buildQueryFromFilters());
    alert("✅ Observación guardada");
  } catch (err) {
    console.error(err);
    alert("❌ " + err.message);
  }
});

// =======================
// Init
// =======================
(async function init() {
  try {
    syncDateInputType();
    await cargarContratos();
    await Promise.all([cargarCompromisos(""), cargarStats("")]);
  } catch (err) {
    console.error(err);
    alert("❌ No se pudo cargar la página de compromisos.");
  }
})();
