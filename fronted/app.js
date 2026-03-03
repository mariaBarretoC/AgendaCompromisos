/**
 * app.js
 * - Filtros: contrato, estado múltiple, responsable, atrasado
 * - Filtro fecha único: (campo + tipo día/mes + valor)
 * - Tabla sin mostrar ID
 * - Evidencia por compromiso: subir/ver/descargar/eliminar (iconos)
 * - Export/Import con filtros
 * - Eliminar seleccionados (bulk)
 */

const API = "http://localhost:3000";

// =======================
// DOM básicos
// =======================
const btnRecargar = document.getElementById("btn-recargar");
const tbody = document.getElementById("tbody-compromisos");
const chkTodos = document.getElementById("chk-todos");

const btnExportar = document.getElementById("btn-exportar");
const btnImportar = document.getElementById("btn-importar");
const fileImport = document.getElementById("file-import");
const btnEliminarSeleccionados = document.getElementById("btn-eliminar-seleccionados");

const contratoSelect = document.getElementById("contrato_id"); // puede no existir en registros.html
const form = document.getElementById("form-compromiso");       // puede no existir en registros.html

// =======================
// Filtros
// =======================
const filtroContrato = document.getElementById("filtro_contrato");
const filtroEstado = document.getElementById("filtro_estado"); // multiple
const filtroResponsable = document.getElementById("filtro_responsable");
const filtroAtrasado = document.getElementById("filtro_atrasado");

const dateField = document.getElementById("date_field"); // creacion/entrega/cierre/reprog
const dateMode = document.getElementById("date_mode");   // day/month
const dateValue = document.getElementById("date_value"); // input date o month

const btnFiltrar = document.getElementById("btn-filtrar");
const btnLimpiar = document.getElementById("btn-limpiar");

// =======================
// Modales (si existen)
// =======================
const dlgReprog = document.getElementById("dlg-reprogramar");
const reprogInfo = document.getElementById("reprog-info");
const nuevaFechaInput = document.getElementById("nueva_fecha");
const btnCancelReprog = document.getElementById("btn-cancel-reprog");
const btnOkReprog = document.getElementById("btn-ok-reprog");

const dlgCerrar = document.getElementById("dlg-cerrar");
const cerrarInfo = document.getElementById("cerrar-info");
const fechaEntregaCompromisoInput = document.getElementById("fecha_entrega_compromiso");
const btnCancelCerrar = document.getElementById("btn-cancel-cerrar");
const btnOkCerrar = document.getElementById("btn-ok-cerrar");

const dlgHistorial = document.getElementById("dlg-historial");
const historialBody = document.getElementById("historial-body");
const btnCerrarHistorial = document.getElementById("btn-cerrar-historial");

const dlgObs = document.getElementById("dlg-observacion");
const obsInfo = document.getElementById("obs-info");
const obsModo = document.getElementById("obs-modo");
const obsTexto = document.getElementById("obs-texto");
const obsActual = document.getElementById("obs-actual");
const btnCancelObs = document.getElementById("btn-cancel-obs");
const btnGuardarObs = document.getElementById("btn-guardar-obs");

// Evidencia
const fileEvidencia = document.getElementById("file-evidencia");
let selectedEvidenciaCompId = null;

// Estado
let selectedId = null;
let selectedObsActual = "";

// =======================
// Helpers
// =======================
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toDateInputValue(dateStr) {
  if (!dateStr) return "";
  return String(dateStr).slice(0, 10);
}

function getSelectedEstados() {
  return [...filtroEstado.selectedOptions].map(o => o.value).filter(Boolean);
}

// =======================
// HTTP
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
// UI: cambiar input date/month
// =======================
function syncDateInputType() {
  // Si es “month” usamos input type="month"
  // Si es “day” usamos input type="date"
  if (dateMode.value === "month") {
    dateValue.type = "month";
  } else {
    dateValue.type = "date";
  }
}
dateMode.addEventListener("change", syncDateInputType);
syncDateInputType();

// =======================
// Contratos
// =======================
async function cargarContratos() {
  const contratos = await apiGet("/contratos");

  // Select crear (solo si existe en esta página)
  if (contratoSelect) {
    contratoSelect.innerHTML = "";
    contratos.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.nombre;
      contratoSelect.appendChild(opt);
    });
  }

  // Select filtro
  filtroContrato.innerHTML = `<option value="">(Todos)</option>`;
  contratos.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.nombre;
    filtroContrato.appendChild(opt);
  });
}

// =======================
// Crear compromiso (solo si existe el form)
// =======================
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const contrato_id = Number(document.getElementById("contrato_id").value);
    const responsable = document.getElementById("responsable").value.trim();
    const compromiso = document.getElementById("compromiso").value.trim();
    const fecha_entrega = document.getElementById("fecha_entrega").value;
    const observacion_general = document.getElementById("observacion_general").value.trim();

    try {
      await apiPost("/compromisos", {
        contrato_id,
        responsable,
        compromiso,
        fecha_entrega,
        observacion_general: observacion_general || null,
      });

      form.reset();
      await cargarCompromisos(buildQueryFromFilters());
      alert("✅ Compromiso guardado");
    } catch (err) {
      console.error(err);
      alert("❌ Error guardando: " + err.message);
    }
  });
}

// =======================
// Query filtros (nuevo filtro fecha)
// =======================
function buildQueryFromFilters() {
  const params = new URLSearchParams();

  if (filtroContrato.value) params.set("contrato_id", filtroContrato.value);

  // Estado múltiple
  getSelectedEstados().forEach((e) => params.append("estado", e));

  const resp = filtroResponsable.value.trim();
  if (resp) params.set("responsable", resp);

  if (filtroAtrasado.value !== "") params.set("atrasado", filtroAtrasado.value);

  // Filtro fecha único (sin desde/hasta)
  // backend debe leer: date_field, date_mode, date_value
  if (dateField.value && dateValue.value) {
    params.set("date_field", dateField.value);
    params.set("date_mode", dateMode.value);   // day | month
    params.set("date_value", dateValue.value); // YYYY-MM-DD o YYYY-MM
  }

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// =======================
// Export / Import
// =======================
btnExportar.addEventListener("click", () => {
  const query = buildQueryFromFilters();
  window.open(`${API}/compromisos/export${query}`, "_blank");
});

btnImportar.addEventListener("click", () => {
  fileImport.value = "";
  fileImport.click();
});

fileImport.addEventListener("change", async () => {
  const file = fileImport.files?.[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    alert("❌ Debe ser un archivo .xlsx");
    return;
  }

  if (!confirm(`¿Importar "${file.name}" a la base de datos?`)) return;

  try {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${API}/compromisos/import`, { method: "POST", body: formData });
    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();
    alert(
      `✅ Importación finalizada\n\n` +
      `Compromisos insertados: ${data.inserted_compromisos}\n` +
      `Historial insertado: ${data.inserted_historial}\n` +
      `Errores: ${data.errors_count}`
    );

    if (data.errors_count) console.log("Errores import:", data.errors);

    await cargarCompromisos(buildQueryFromFilters());
  } catch (err) {
    console.error(err);
    alert("❌ Error importando: " + err.message);
  }
});

// =======================
// Tabla
// =======================
function estadoBadge(estado) {
  if (estado === "Pendiente") return `<span class="badge badge--pendiente">Pendiente</span>`;
  if (estado === "Reprogramado") return `<span class="badge badge--reprog">Reprogramado</span>`;
  if (estado === "Cerrado") return `<span class="badge badge--cerrado">Cerrado</span>`;
  return `<span class="badge">${escapeHtml(estado)}</span>`;
}

function evidenciaCell(c) {
  const tiene = Number(c.tiene_evidencia ?? 0) === 1 || Boolean(c.evidencia);
  if (!tiene) return `<span class="hint">Sin evidencia</span>`;

  return `
    <div class="actions">
      <button class="iconbtn" type="button" title="Ver" data-action="evi_ver" data-id="${c.id}">👁</button>
      <button class="iconbtn" type="button" title="Descargar" data-action="evi_down" data-id="${c.id}">⬇</button>
      <button class="iconbtn" type="button" title="Eliminar" data-action="evi_del" data-id="${c.id}">🗑</button>
    </div>
  `;
}

async function cargarCompromisos(query = "") {
  const compromisos = await apiGet("/compromisos" + query);

  tbody.innerHTML = "";

  compromisos.forEach((c) => {
    const tr = document.createElement("tr");

    // Marca atrasados con un tono suave
    if (Number(c.atrasado) === 1) tr.classList.add("row-late");

    const obs = c.observacion_general || "";
    const obsPreview = obs.length > 60 ? obs.slice(0, 60) + "..." : obs;

    tr.innerHTML = `
      <td class="col-check">
        <input type="checkbox" class="chk-compromiso" data-id="${c.id}">
      </td>

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
          <button class="iconbtn" type="button" title="Historial" data-action="historial" data-id="${c.id}">🕓</button>
          <button class="iconbtn" type="button" title="Reprogramar" data-action="reprogramar" data-id="${c.id}" ${c.estado === "Cerrado" ? "disabled" : ""}>📅</button>
          <button class="iconbtn" type="button" title="Cerrar" data-action="cerrar" data-id="${c.id}" ${c.estado === "Cerrado" ? "disabled" : ""}>✅</button>
          <button class="iconbtn" type="button" title="Eliminar" data-action="eliminar" data-id="${c.id}">🗑</button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

// =======================
// Filtros / Recargar
// =======================
btnFiltrar.addEventListener("click", async () => {
  await cargarCompromisos(buildQueryFromFilters());
});

btnLimpiar.addEventListener("click", async () => {
  filtroContrato.value = "";
  filtroResponsable.value = "";
  filtroAtrasado.value = "";

  [...filtroEstado.options].forEach(o => (o.selected = false));

  dateField.value = "";
  dateMode.value = "day";
  syncDateInputType();
  dateValue.value = "";

  await cargarCompromisos("");
});

btnRecargar.addEventListener("click", () => {
  cargarCompromisos(buildQueryFromFilters());
});

// =======================
// Seleccionar todos
// =======================
chkTodos.addEventListener("change", () => {
  document.querySelectorAll(".chk-compromiso").forEach((c) => {
    c.checked = chkTodos.checked;
  });
});

// =======================
// Eliminar seleccionados (bulk)
// =======================
btnEliminarSeleccionados.addEventListener("click", async () => {
  const ids = [...document.querySelectorAll(".chk-compromiso:checked")]
    .map((x) => Number(x.dataset.id))
    .filter((n) => Number.isFinite(n));

  if (ids.length === 0) return alert("Selecciona al menos 1 compromiso.");
  if (!confirm(`¿Seguro que deseas eliminar ${ids.length} compromiso(s)?`)) return;

  try {
    const res = await apiPost("/compromisos/delete-bulk", { ids });
    alert(`✅ Eliminados: ${res.deleted_count}`);
    chkTodos.checked = false;
    await cargarCompromisos(buildQueryFromFilters());
  } catch (err) {
    console.error(err);
    alert("❌ Error eliminando: " + err.message);
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

  if (!file.type.startsWith("image/")) {
    alert("❌ Debe ser una imagen (jpg/png/webp).");
    return;
  }

  if (!confirm(`¿Subir evidencia para el compromiso ID ${selectedEvidenciaCompId}?`)) return;

  try {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${API}/compromisos/${selectedEvidenciaCompId}/evidencia`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) throw new Error(await res.text());

    alert("✅ Evidencia subida");
    await cargarCompromisos(buildQueryFromFilters());
  } catch (err) {
    console.error(err);
    alert("❌ Error subiendo evidencia: " + err.message);
  } finally {
    selectedEvidenciaCompId = null;
  }
});

// =======================
// Acciones tabla
// =======================
tbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const id = Number(btn.dataset.id);
  const action = btn.dataset.action;

  // Evidencia
  if (action === "evi_up") return abrirSelectorEvidencia(id);
  if (action === "evi_ver") return window.open(`${API}/compromisos/${id}/evidencia/view`, "_blank");
  if (action === "evi_down") return window.open(`${API}/compromisos/${id}/evidencia/download`, "_blank");

  if (action === "evi_del") {
    if (!confirm("¿Eliminar la evidencia de este compromiso?")) return;
    try {
      await apiDelete(`/compromisos/${id}/evidencia`);
      alert("✅ Evidencia eliminada");
      await cargarCompromisos(buildQueryFromFilters());
    } catch (err) {
      console.error(err);
      alert("❌ Error eliminando evidencia: " + err.message);
    }
    return;
  }

  // CRUD
  if (action === "reprogramar") {
    selectedId = id;
    reprogInfo.textContent = `Compromiso ID: ${id}`;
    nuevaFechaInput.value = "";
    dlgReprog.showModal();
    return;
  }

  if (action === "cerrar") {
    selectedId = id;
    cerrarInfo.textContent = `Compromiso ID: ${id}`;
    fechaEntregaCompromisoInput.value = "";
    dlgCerrar.showModal();
    return;
  }

  if (action === "historial") {
    selectedId = id;
    const hist = await apiGet(`/compromisos/${id}/historial`);
    historialBody.innerHTML = !hist.length
      ? "<div class='hint'>No hay reprogramaciones.</div>"
      : `
        <table style="width:100%; border-collapse:collapse; margin-top:10px;">
          <thead>
            <tr>
              <th style="border:1px solid #ddd; padding:8px;">Anterior</th>
              <th style="border:1px solid #ddd; padding:8px;">Nueva</th>
              <th style="border:1px solid #ddd; padding:8px;">Fecha cambio</th>
            </tr>
          </thead>
          <tbody>
            ${hist.map(h => `
              <tr>
                <td style="border:1px solid #ddd; padding:8px;">${escapeHtml(toDateInputValue(h.fecha_anterior))}</td>
                <td style="border:1px solid #ddd; padding:8px;">${escapeHtml(toDateInputValue(h.nueva_fecha))}</td>
                <td style="border:1px solid #ddd; padding:8px;">${escapeHtml(String(h.fecha_reprogramacion).replace("T"," ").slice(0,19))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    dlgHistorial.showModal();
    return;
  }

  if (action === "observacion") {
    selectedId = id;
    const obs = decodeURIComponent(btn.dataset.obs || "");
    selectedObsActual = obs;
    obsInfo.textContent = `Compromiso ID: ${id}`;
    obsTexto.value = "";
    obsModo.value = "append";
    obsActual.value = selectedObsActual || "";
    dlgObs.showModal();
    return;
  }

  if (action === "eliminar") {
    if (!confirm("¿Eliminar este compromiso?")) return;
    try {
      await apiDelete(`/compromisos/${id}`);
      alert("✅ Eliminado");
      await cargarCompromisos(buildQueryFromFilters());
    } catch (err) {
      console.error(err);
      alert("❌ Error eliminando: " + err.message);
    }
    return;
  }
});

// Modales: reprogramar / cerrar / observación
btnCancelReprog?.addEventListener("click", () => dlgReprog.close());
btnOkReprog?.addEventListener("click", async () => {
  const nueva_fecha = nuevaFechaInput.value;
  if (!nueva_fecha) return alert("Selecciona la nueva fecha acordada");

  try {
    await apiPost(`/compromisos/${selectedId}/reprogramar`, { nueva_fecha });
    dlgReprog.close();
    await cargarCompromisos(buildQueryFromFilters());
    alert("✅ Reprogramado");
  } catch (err) {
    console.error(err);
    alert("❌ Error reprogramando: " + err.message);
  }
});

btnCancelCerrar?.addEventListener("click", () => dlgCerrar.close());
btnOkCerrar?.addEventListener("click", async () => {
  const fecha_entrega_compromiso = fechaEntregaCompromisoInput.value;
  if (!fecha_entrega_compromiso) return alert("Selecciona la fecha de entrega real");

  try {
    await apiPost(`/compromisos/${selectedId}/cerrar`, { fecha_entrega_compromiso });
    dlgCerrar.close();
    await cargarCompromisos(buildQueryFromFilters());
    alert("✅ Cerrado");
  } catch (err) {
    console.error(err);
    alert("❌ Error cerrando: " + err.message);
  }
});

btnCerrarHistorial?.addEventListener("click", () => dlgHistorial.close());

btnCancelObs?.addEventListener("click", () => dlgObs.close());
btnGuardarObs?.addEventListener("click", async () => {
  const texto = obsTexto.value.trim();
  const modo = obsModo.value;
  if (!texto) return alert("Escribe la observación");

  try {
    const updated = await apiPatch(`/compromisos/${selectedId}/observacion`, { texto, modo });
    selectedObsActual = updated.observacion_general || "";
    obsActual.value = selectedObsActual;
    obsTexto.value = "";
    await cargarCompromisos(buildQueryFromFilters());
    alert("✅ Observación guardada");
  } catch (err) {
    console.error(err);
    alert("❌ Error guardando observación: " + err.message);
  }
});

// =======================
// Init
// =======================
(async function init() {
  try {
    await cargarContratos();
    await cargarCompromisos("");
  } catch (err) {
    console.error(err);
    alert("❌ No se pudo cargar la app. Revisa que el backend esté corriendo.");
  }
})();