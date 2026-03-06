/**
 * server.js - Agenda de Compromisos (Empresa)
 *
 * Incluye:
 * - CRUD de contratos y compromisos
 * - Filtros avanzados:
 *    - contrato_id
 *    - responsable (LIKE)
 *    - atrasado (1/0)
 *    - multi-estado (estado=Pendiente&estado=Reprogramado) o (estado=Pendiente,Reprogramado)
 *    - filtro fecha único (día/mes):
 *        date_field=creacion|entrega|cierre|reprog
 *        date_mode=day|month
 *        date_value=YYYY-MM-DD o YYYY-MM
 * - Exportar Excel con filtros
 * - Importar Excel (xlsx) a BD
 * - Evidencia (1 imagen por compromiso): subir / ver / descargar / eliminar
 * - Eliminar compromisos (individual / masivo)
 */

// Configuración de Cloudinary (para usarlo para evidencias en lugar de disco local)
const cloudinary = require("cloudinary").v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function uploadBufferToCloudinary(buffer, folder = "agenda-compromisos") {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    stream.end(buffer);
  });
}

require("dotenv").config();


const express = require("express");     // Framework web
const cors = require("cors");           // Permite llamadas desde tu frontend (CORS)
const mysql = require("mysql2/promise");// MySQL con promesas
const ExcelJS = require("exceljs");     // Export/Import xlsx

const multer = require("multer");       // Subida de archivos
const path = require("path");           // Manejo de rutas
const fs = require("fs");               // Manejo de archivos en disco

const app = express();

// ---------------------------
// Middlewares globales
// ---------------------------
const allowedOrigins = [
  "https://agendacompromisos.pages.dev",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Postman / curl
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS bloqueado: " + origin));
  },
  credentials: false,
}));

// ---------------------------
// Configuración MySQL
// ---------------------------
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
};

let pool;

/**
 * Inicializa el pool de conexiones a MySQL (reutilizable y eficiente).
 */
async function initDB() {
  pool = await mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  // Prueba rápida de conexión
  await pool.query("SELECT 1");
  console.log("✅ Conectado a MySQL");
}

// ---------------------------
// Helpers de fecha
// ---------------------------
function todayISO() {
  // Retorna fecha de hoy en formato YYYY-MM-DD
  return new Date().toISOString().slice(0, 10);
}

function isISODate(value) {
  // Valida formato YYYY-MM-DD
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isISOMonth(value) {
  // Valida formato YYYY-MM
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

// ------------------ Salud ------------------
app.get("/", (req, res) => res.send("API Agenda OK ✅"));

// =========================================================
//  EVIDENCIAS (IMÁGENES) - 1 por compromiso
// =========================================================

// Carpeta física para guardar imágenes (server/uploads)
//const UPLOAD_DIR = path.join(__dirname, "uploads");
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? process.env.UPLOAD_DIR
  : path.join(__dirname, "uploads");

// Crear carpeta si no existe
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Servimos la carpeta /uploads como estática
// Ej: http://localhost:3000/uploads/archivo.png
app.use("/uploads", express.static(UPLOAD_DIR));

/**
 * Multer storage para evidencias: guarda en disco.
 * Se crea un nombre único: timestamp + nombre original "seguro".
 */
const uploadEvidencia = multer({
  storage: multer.memoryStorage(),
  fileFilter: fileFilterImagen,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Filtro: solo imágenes permitidas
function fileFilterImagen(req, file, cb) {
  const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
  if (!ok) return cb(new Error("Solo se permiten imágenes JPG, PNG o WEBP"), false);
  cb(null, true);
}

// =========================================================
//  IMPORT EXCEL (xlsx) - usa memoria (NO disco)
// =========================================================
const uploadExcel = multer({ storage: multer.memoryStorage() });

// =========================================================
//  CONTRATOS
// =========================================================

/**
 * GET /contratos
 * Retorna contratos activos
 */
app.get("/contratos", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, nombre FROM contratos WHERE activo = 1 ORDER BY nombre"
    );
    res.json(rows);
  } catch (err) {
    console.error("Error GET /contratos:", err);
    res.status(500).json({ error: "Error consultando contratos" });
  }
});

/**
 * POST /contratos
 * Body: { nombre }
 * Crea contrato activo
 */
app.post("/contratos", async (req, res) => {
  try {
    const { nombre } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: "El campo 'nombre' es obligatorio" });
    }

    const clean = nombre.trim();

    const [result] = await pool.query(
      "INSERT INTO contratos (nombre, activo) VALUES (?, 1)",
      [clean]
    );

    res.status(201).json({ id: result.insertId, nombre: clean, activo: 1 });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Ese contrato ya existe" });
    }
    console.error("Error POST /contratos:", err);
    res.status(500).json({ error: "Error creando contrato" });
  }
});

// =========================================================
//  FILTROS (Helper)
// =========================================================

/**
 * Normaliza estado multi.
 * Soporta:
 *  - estado="Pendiente,Reprogramado"
 *  - estado=["Pendiente","Reprogramado"] (query repetida)
 */
function normalizeEstadoMulti(q) {
  const raw = q.estado;
  let list = [];

  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string" && raw.includes(",")) list = raw.split(",");
  else if (typeof raw === "string" && raw.trim()) list = [raw];

  const allowed = new Set(["Pendiente", "Reprogramado", "Cerrado"]);
  return list.map(s => String(s).trim()).filter(s => allowed.has(s));
}

/**
 * Aplica filtro de fecha único (día/mes).
 * Recibe:
 *  date_field = creacion|entrega|cierre|reprog
 *  date_mode  = day|month
 *  date_value = YYYY-MM-DD o YYYY-MM
 *
 * Retorna:
 *  - agrega condiciones SQL en where/params
 *  - si hay error de formato devuelve { error: "..."}
 */
function applySingleDateFilter(query, where, params) {
  const date_field = String(query.date_field || "").trim(); // campo
  const date_mode  = String(query.date_mode || "").trim();  // day | month
  const date_value = String(query.date_value || "").trim(); // YYYY-MM-DD o YYYY-MM

  // Si no hay filtro, no hacemos nada
  if (!date_field || !date_value) return null;

  const validField = new Set(["creacion", "entrega", "cierre", "reprog"]);
  const validMode  = new Set(["day", "month"]);

  if (!validField.has(date_field)) {
    return { error: "date_field inválido. Use: creacion|entrega|cierre|reprog" };
  }
  if (!validMode.has(date_mode)) {
    return { error: "date_mode inválido. Use: day|month" };
  }

  // Definimos columna SQL por date_field
  // - creacion -> c.fecha_creacion
  // - entrega  -> c.fecha_entrega
  // - cierre   -> c.fecha_entrega_compromiso
  // - reprog   -> hr.fecha_reprogramacion (tabla historial)
  let columnSQL = null;
  if (date_field === "creacion") columnSQL = "c.fecha_creacion";
  if (date_field === "entrega")  columnSQL = "c.fecha_entrega";
  if (date_field === "cierre")   columnSQL = "c.fecha_entrega_compromiso";

  // --- Modo "day": YYYY-MM-DD ---
  if (date_mode === "day") {
    if (!isISODate(date_value)) {
      return { error: "date_value debe ser YYYY-MM-DD cuando date_mode=day" };
    }

    // Si es reprog, buscamos en historial por fecha_reprogramacion en ese día
    if (date_field === "reprog") {
      where.push(`
        EXISTS (
          SELECT 1
          FROM historial_reprogramaciones hr
          WHERE hr.compromiso_id = c.id
            AND hr.fecha_reprogramacion >= ?
            AND hr.fecha_reprogramacion <= ?
        )
      `);
      params.push(`${date_value} 00:00:00`, `${date_value} 23:59:59`);
      return null;
    }

    // Para campos en compromisos: usamos DATE(col) = date_value
    // (funciona aunque el campo sea DATETIME o DATE)
    where.push(`DATE(${columnSQL}) = ?`);
    params.push(date_value);
    return null;
  }

  // --- Modo "month": YYYY-MM ---
  if (date_mode === "month") {
    if (!isISOMonth(date_value)) {
      return { error: "date_value debe ser YYYY-MM cuando date_mode=month" };
    }

    // rango del mes (YYYY-MM-01 hasta fin de mes)
    const start = `${date_value}-01`;
    // fin del mes: usamos LAST_DAY en SQL
    // (para no calcularlo en JS)
    if (date_field === "reprog") {
      where.push(`
        EXISTS (
          SELECT 1
          FROM historial_reprogramaciones hr
          WHERE hr.compromiso_id = c.id
            AND hr.fecha_reprogramacion >= CONCAT(?, ' 00:00:00')
            AND hr.fecha_reprogramacion <  CONCAT(DATE_ADD(LAST_DAY(?), INTERVAL 1 DAY), ' 00:00:00')
        )
      `);
      params.push(start, start);
      return null;
    }

    // Para campos en compromisos: entre start y el día después del último día (rango semi-abierto)
    where.push(`
      DATE(${columnSQL}) >= ?
      AND DATE(${columnSQL}) < DATE_ADD(LAST_DAY(?), INTERVAL 1 DAY)
    `);
    params.push(start, start);
    return null;
  }

  return null;
}

/**
 * buildFilters:
 * Arma WHERE y params para:
 *  - GET /compromisos
 *  - GET /compromisos/export
 */
function buildFilters(query) {
  const { contrato_id, responsable, atrasado } = query;

  const where = [];
  const params = [];

  // 1) contrato_id
  if (contrato_id) {
    where.push("c.contrato_id = ?");
    params.push(Number(contrato_id));
  }

  // 2) estado multi
  const estados = normalizeEstadoMulti(query);
  if (estados.length) {
    where.push(`c.estado IN (${estados.map(() => "?").join(",")})`);
    params.push(...estados);
  }

  // 3) responsable LIKE
  if (responsable && String(responsable).trim()) {
    where.push("c.responsable LIKE ?");
    params.push(`%${String(responsable).trim()}%`);
  }

  // 4) atrasado
  if (atrasado === "1") {
    where.push("(c.estado <> 'Cerrado' AND c.fecha_entrega < CURDATE())");
  } else if (atrasado === "0") {
    where.push("NOT (c.estado <> 'Cerrado' AND c.fecha_entrega < CURDATE())");
  }

  // 5) NUEVO: filtro fecha único (día/mes)
  const dateErr = applySingleDateFilter(query, where, params);
  if (dateErr?.error) return { error: dateErr.error };

  return { where, params };
}

// =========================================================
//  COMPROMISOS - LISTAR / CREAR / REPROGRAMAR / CERRAR / OBS
//  + evidencias (LEFT JOIN)
// =========================================================

/**
 * GET /compromisos
 * Devuelve registros para la tabla del front.
 * Incluye evidencia si existe.
 */
app.get("/compromisos", async (req, res) => {
  try {
    const built = buildFilters(req.query);
    if (built.error) return res.status(400).json({ error: built.error });

    const { where, params } = built;
    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // LEFT JOIN a evidencias para traer 1 evidencia (si existe)
    // Nota: asumimos 1 evidencia por compromiso (por tu lógica)
    const sql = `
      SELECT 
        c.id,
        c.fecha_creacion,
        c.contrato_id,
        ct.nombre AS contrato,
        c.responsable,
        c.compromiso,
        c.fecha_entrega,
        c.estado,
        c.cantidad_reprogramaciones,
        c.fecha_entrega_compromiso,
        c.observacion_general,

        e.id AS evidencia_id,
        e.url AS evidencia_url,
        e.originalname AS evidencia_nombre,
        CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS tiene_evidencia,

        CASE 
          WHEN c.estado <> 'Cerrado' AND c.fecha_entrega < CURDATE()
          THEN 1 ELSE 0
        END AS atrasado
      FROM compromisos c
      JOIN contratos ct ON ct.id = c.contrato_id
      LEFT JOIN evidencias e ON e.compromiso_id = c.id
      ${whereSQL}
      ORDER BY
        FIELD(c.estado,'Pendiente','Reprogramado','Cerrado'),
        c.fecha_entrega ASC,
        c.id DESC
      LIMIT 500
    `;

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("Error GET /compromisos:", err);
    res.status(500).json({ error: "Error consultando compromisos" });
  }
});

/**
 * POST /compromisos
 * Crea un compromiso.
 */
app.post("/compromisos", async (req, res) => {
  try {
    const { contrato_id, responsable, compromiso, fecha_entrega, observacion_general } = req.body;

    // Validaciones mínimas
    if (!contrato_id || !responsable || !compromiso || !fecha_entrega) {
      return res.status(400).json({
        error: "Faltan campos: contrato_id, responsable, compromiso, fecha_entrega",
      });
    }

    if (!isISODate(fecha_entrega)) {
      return res.status(400).json({ error: "fecha_entrega debe ser YYYY-MM-DD" });
    }

    // Valida contrato activo
    const [ct] = await pool.query(
      "SELECT id FROM contratos WHERE id = ? AND activo = 1",
      [contrato_id]
    );
    if (ct.length === 0) return res.status(400).json({ error: "Contrato inválido o inactivo" });

    // Inserta registro
    const [result] = await pool.query(
      `
      INSERT INTO compromisos
        (fecha_creacion, contrato_id, responsable, compromiso, fecha_entrega, observacion_general)
      VALUES
        (CURDATE(), ?, ?, ?, ?, ?)
      `,
      [
        contrato_id,
        String(responsable).trim(),
        String(compromiso).trim(),
        fecha_entrega,
        observacion_general ? String(observacion_general).trim() : null,
      ]
    );

    // Retorna el registro creado
    const [rows] = await pool.query("SELECT * FROM compromisos WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Error POST /compromisos:", err);
    res.status(500).json({ error: "Error creando compromiso" });
  }
});

/**
 * POST /compromisos/:id/reprogramar
 * Crea historial + actualiza compromiso:
 *  - fecha_entrega = nueva
 *  - estado = Reprogramado
 *  - cantidad_reprogramaciones ++
 */
app.post("/compromisos/:id/reprogramar", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const nueva_fecha = String(req.body?.nueva_fecha || "").trim();

    // --------------------------
    // 1) Validaciones básicas
    // --------------------------
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }

    if (!nueva_fecha) {
      return res.status(400).json({ error: "Faltan datos: nueva_fecha" });
    }

    if (!isISODate(nueva_fecha)) {
      return res.status(400).json({ error: "nueva_fecha debe ser YYYY-MM-DD" });
    }

    // --------------------------
    // 2) Buscar compromiso
    // --------------------------
    const [rows] = await pool.query(
      "SELECT id, fecha_entrega, estado FROM compromisos WHERE id = ?",
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "No existe el compromiso" });
    }

    const comp = rows[0];

    // Normaliza fecha_entrega (puede venir Date o string)
    const fechaActual = (comp.fecha_entrega instanceof Date)
      ? comp.fecha_entrega.toISOString().slice(0, 10)
      : String(comp.fecha_entrega).slice(0, 10);

    // --------------------------
    // 3) Reglas de negocio
    // --------------------------
    if (comp.estado === "Cerrado") {
      return res.status(409).json({ error: "El compromiso está Cerrado y no se puede reprogramar" });
    }

    // ✅ HOY en hora LOCAL del servidor (evita problemas UTC)
    const hoyLocal = new Date();
    hoyLocal.setHours(0, 0, 0, 0);
    const hoy = hoyLocal.toISOString().slice(0, 10);

    // ✅ Permitir reprogramar a hoy o futuro (pero no al pasado)
    if (nueva_fecha < hoy) {
      return res.status(400).json({ error: "No puedes reprogramar a una fecha anterior a hoy" });
    }

    // ✅ Evitar reprogramar a la misma fecha (opcional pero recomendado)
    if (nueva_fecha === fechaActual) {
      return res.status(400).json({ error: "La nueva fecha debe ser diferente a la actual" });
    }

    // --------------------------
    // 4) Guardar historial + actualizar (transacción)
    // --------------------------
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `INSERT INTO historial_reprogramaciones (compromiso_id, fecha_anterior, nueva_fecha)
         VALUES (?, ?, ?)`,
        [id, fechaActual, nueva_fecha]
      );

      await conn.query(
        `UPDATE compromisos
         SET fecha_entrega = ?,
             cantidad_reprogramaciones = cantidad_reprogramaciones + 1,
             estado = 'Reprogramado'
         WHERE id = ?`,
        [nueva_fecha, id]
      );

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    // --------------------------
    // 5) Retornar actualizado
    // --------------------------
    const [updated] = await pool.query("SELECT * FROM compromisos WHERE id = ?", [id]);
    return res.json(updated[0]);

  } catch (err) {
    console.error("Error POST /compromisos/:id/reprogramar:", err);
    return res.status(500).json({ error: "Error reprogramando compromiso" });
  }
});

/**
 * POST /compromisos/:id/cerrar
 * Marca compromiso como Cerrado con fecha_entrega_compromiso.
 */
app.post("/compromisos/:id/cerrar", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { fecha_entrega_compromiso } = req.body;

    if (!id || !fecha_entrega_compromiso) {
      return res.status(400).json({ error: "Faltan datos: fecha_entrega_compromiso" });
    }
    if (!isISODate(fecha_entrega_compromiso)) {
      return res.status(400).json({ error: "fecha_entrega_compromiso debe ser YYYY-MM-DD" });
    }

    const [rows] = await pool.query("SELECT estado FROM compromisos WHERE id = ?", [id]);
    if (rows.length === 0) return res.status(404).json({ error: "No existe el compromiso" });

    if (rows[0].estado === "Cerrado") {
      return res.status(409).json({ error: "El compromiso ya está Cerrado" });
    }

    await pool.query(
      `UPDATE compromisos
       SET fecha_entrega_compromiso = ?,
           estado = 'Cerrado'
       WHERE id = ?`,
      [fecha_entrega_compromiso, id]
    );

    const [updated] = await pool.query("SELECT * FROM compromisos WHERE id = ?", [id]);
    res.json(updated[0]);
  } catch (err) {
    console.error("Error POST /compromisos/:id/cerrar:", err);
    res.status(500).json({ error: "Error cerrando compromiso" });
  }
});

/**
 * GET /compromisos/:id/historial
 * Retorna historial de reprogramaciones.
 */
app.get("/compromisos/:id/historial", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [rows] = await pool.query(
      `SELECT id, compromiso_id, fecha_anterior, nueva_fecha, fecha_reprogramacion
       FROM historial_reprogramaciones
       WHERE compromiso_id = ?
       ORDER BY fecha_reprogramacion ASC`,
      [id]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error GET /compromisos/:id/historial:", err);
    res.status(500).json({ error: "Error consultando historial" });
  }
});

/**
 * PATCH /compromisos/:id/observacion
 * Body: { texto, modo: "append"|"replace" }
 */
app.patch("/compromisos/:id/observacion", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { texto, modo } = req.body;

    if (!id) return res.status(400).json({ error: "ID inválido" });
    if (!texto || !String(texto).trim()) {
      return res.status(400).json({ error: "El campo 'texto' es obligatorio" });
    }

    const [rows] = await pool.query(
      "SELECT id, observacion_general FROM compromisos WHERE id = ?",
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "No existe el compromiso" });

    const actual = rows[0].observacion_general || "";
    const clean = String(texto).trim();

    let nuevaObs = clean;

    // append: agrega bitácora con sello
    if (modo === "append") {
      const sello = new Date().toISOString().replace("T", " ").slice(0, 19);
      nuevaObs = actual ? `${actual}\n\n[${sello}] ${clean}` : `[${sello}] ${clean}`;
    }

    await pool.query(
      "UPDATE compromisos SET observacion_general = ? WHERE id = ?",
      [nuevaObs, id]
    );

    const [updated] = await pool.query("SELECT * FROM compromisos WHERE id = ?", [id]);
    res.json(updated[0]);
  } catch (err) {
    console.error("Error PATCH /compromisos/:id/observacion:", err);
    res.status(500).json({ error: "Error guardando observación" });
  }
});

// =========================================================
//  EVIDENCIA - ENDPOINTS (1 imagen por compromiso)
// =========================================================

/**
 * POST /compromisos/:id/evidencia
 * form-data: file
 * - Si ya había evidencia, se borra y se reemplaza.
 */
app.post("/compromisos/:id/evidencia", uploadEvidencia.single("file"), async (req, res) => {
  try {
    const compromisoId = Number(req.params.id);
    if (!compromisoId) {
      return res.status(400).json({ error: "ID inválido" });
    }

    // 1) Validar que el compromiso exista
    const [compromisos] = await pool.query(
      "SELECT id FROM compromisos WHERE id = ?",
      [compromisoId]
    );

    if (!compromisos.length) {
      return res.status(404).json({ error: "No existe el compromiso" });
    }

    // 2) Validar que sí venga archivo
    if (!req.file) {
      return res.status(400).json({ error: "No se recibió archivo (field: file)" });
    }

    // 3) Buscar evidencia previa en la BD
    const [prev] = await pool.query(
      "SELECT id, cloudinary_public_id FROM evidencias WHERE compromiso_id = ? LIMIT 1",
      [compromisoId]
    );

    // 4) Si ya existía evidencia, borrarla de Cloudinary y de la BD
    if (prev.length) {
      if (prev[0].cloudinary_public_id) {
        await cloudinary.uploader.destroy(prev[0].cloudinary_public_id);
      }

      await pool.query(
        "DELETE FROM evidencias WHERE id = ?",
        [prev[0].id]
      );
    }

    // 5) Subir nueva imagen a Cloudinary
    const uploadResult = await uploadBufferToCloudinary(req.file.buffer);

    const url = uploadResult.secure_url;
    const publicId = uploadResult.public_id;

    // 6) Guardar evidencia nueva en la BD
    const [ins] = await pool.query(
      `
      INSERT INTO evidencias
        (compromiso_id, cloudinary_public_id, originalname, mimetype, size, url)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        compromisoId,
        publicId,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        url,
      ]
    );

    // 7) Responder al frontend
    res.status(201).json({
      id: ins.insertId,
      compromiso_id: compromisoId,
      url,
      originalname: req.file.originalname,
      cloudinary_public_id: publicId,
    });

  } catch (err) {
    console.error("Error POST /compromisos/:id/evidencia:", err);
    res.status(500).json({ error: "Error subiendo evidencia" });
  }
});

/**
 * GET /compromisos/:id/evidencia
 * Retorna metadata (1 evidencia o null)
 */
app.get("/compromisos/:id/evidencia", async (req, res) => {
  try {
    const compromisoId = Number(req.params.id);
    if (!compromisoId) return res.status(400).json({ error: "ID inválido" });

    const [rows] = await pool.query(
      `
      SELECT id, url, originalname, mimetype, size, fecha_subida
      FROM evidencias
      WHERE compromiso_id = ?
      LIMIT 1
      `,
      [compromisoId]
    );

    res.json(rows[0] || null);
  } catch (err) {
    console.error("Error GET /compromisos/:id/evidencia:", err);
    res.status(500).json({ error: "Error consultando evidencia" });
  }
});

/**
 * GET /compromisos/:id/evidencia/view
 * Abre la imagen en el navegador usando la URL guardada en Cloudinary.
 */
app.get("/compromisos/:id/evidencia/view", async (req, res) => {
  try {
    const compromisoId = Number(req.params.id);
    if (!compromisoId) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const [rows] = await pool.query(
      "SELECT url FROM evidencias WHERE compromiso_id = ? LIMIT 1",
      [compromisoId]
    );

    if (!rows.length) {
      return res.status(404).send("No hay evidencia.");
    }

    return res.redirect(rows[0].url);

  } catch (err) {
    console.error("Error GET /compromisos/:id/evidencia/view:", err);
    res.status(500).json({ error: "Error mostrando evidencia" });
  }
});

/**
 * GET /compromisos/:id/evidencia/download
 * Redirige a la URL de la evidencia en Cloudinary.
 */
app.get("/compromisos/:id/evidencia/download", async (req, res) => {
  try {
    const compromisoId = Number(req.params.id);
    if (!compromisoId) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const [rows] = await pool.query(
      "SELECT url FROM evidencias WHERE compromiso_id = ? LIMIT 1",
      [compromisoId]
    );

    if (!rows.length) {
      return res.status(404).send("No hay evidencia.");
    }

    return res.redirect(rows[0].url);

  } catch (err) {
    console.error("Error GET /compromisos/:id/evidencia/download:", err);
    res.status(500).json({ error: "Error descargando evidencia" });
  }
});

/**
 * DELETE /compromisos/:id/evidencia
 * Borra evidencia (BD + archivo físico)
 */
app.delete("/compromisos/:id/evidencia", async (req, res) => {
  try {
    const compromisoId = Number(req.params.id);
    if (!compromisoId) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const [rows] = await pool.query(
      "SELECT id, cloudinary_public_id FROM evidencias WHERE compromiso_id = ? LIMIT 1",
      [compromisoId]
    );

    if (!rows.length) {
      return res.json({ ok: true, deleted: 0 });
    }

    // 1) Borrar imagen en Cloudinary
    if (rows[0].cloudinary_public_id) {
      await cloudinary.uploader.destroy(rows[0].cloudinary_public_id);
    }

    // 2) Borrar registro de la BD
    await pool.query(
      "DELETE FROM evidencias WHERE id = ?",
      [rows[0].id]
    );

    res.json({ ok: true, deleted: 1 });

  } catch (err) {
    console.error("Error DELETE /compromisos/:id/evidencia:", err);
    res.status(500).json({ error: "Error eliminando evidencia" });
  }
});

// =========================================================
//  EXPORT EXCEL (con filtros)
// =========================================================

/**
 * GET /compromisos/export
 * Descarga un .xlsx con filtros aplicados
 */
app.get("/compromisos/export", async (req, res) => {
  try {
    const built = buildFilters(req.query);
    if (built.error) return res.status(400).json({ error: built.error });

    const { where, params } = built;
    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const sql = `
      SELECT 
        c.fecha_creacion AS "Fecha Creación",
        ct.nombre AS "Contrato",
        c.responsable AS "Responsable",
        c.compromiso AS "Compromiso",
        c.fecha_entrega AS "Fecha Entrega (Acordada)",
        c.estado AS "Estado",
        c.cantidad_reprogramaciones AS "Reprogramaciones",
        c.fecha_entrega_compromiso AS "Fecha Cierre (Real)",
        e.url AS "Evidencia (URL)",
        CASE 
          WHEN c.estado <> 'Cerrado' AND c.fecha_entrega < CURDATE()
          THEN 'Sí' ELSE 'No'
        END AS "Atrasado",
        c.observacion_general AS "Observación General"
      FROM compromisos c
      JOIN contratos ct ON ct.id = c.contrato_id
      LEFT JOIN evidencias e ON e.compromiso_id = c.id
      ${whereSQL}
      ORDER BY
        FIELD(c.estado,'Pendiente','Reprogramado','Cerrado'),
        c.fecha_entrega ASC,
        c.id DESC
    `;

    const [rows] = await pool.query(sql, params);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Compromisos");

    const columns = rows.length
      ? Object.keys(rows[0])
      : [
          "Fecha Creación",
          "Contrato",
          "Responsable",
          "Compromiso",
          "Fecha Entrega (Acordada)",
          "Estado",
          "Reprogramaciones",
          "Fecha Cierre (Real)",
          "Evidencia (URL)",
          "Atrasado",
          "Observación General",
        ];

    ws.columns = columns.map((c) => ({
      header: c,
      key: c,
      width: Math.min(Math.max(c.length + 2, 16), 45),
    }));

    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

    rows.forEach((r) => ws.addRow(r));

    ws.columns.forEach((col) => {
      if (col.header === "Compromiso" || col.header === "Observación General") {
        col.alignment = { wrapText: true, vertical: "top" };
        col.width = 60;
      }
    });

    ws.views = [{ state: "frozen", ySplit: 1 }];

    const fileName = `compromisos_${todayISO()}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error GET /compromisos/export:", err);
    res.status(500).json({ error: "Error exportando a Excel" });
  }
});

// =========================================================
//  IMPORT EXCEL (xlsx) - tu lógica se mantiene
// =========================================================

app.post("/compromisos/import", uploadExcel.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No se recibió archivo (field: file)" });
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);

    const ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: "El archivo no tiene hojas" });

    const headerRow = ws.getRow(1);
    const headers = {};
    headerRow.eachCell((cell, colNumber) => {
      const name = String(cell.value ?? "").trim();
      if (name) headers[name] = colNumber;
    });

    const required = ["Contrato", "Responsable", "Compromiso", "Fecha Entrega (Acordada)"];
    for (const r of required) {
      if (!headers[r]) return res.status(400).json({ error: `Falta columna requerida: "${r}"` });
    }

    const getCell = (row, headerName) => {
      const col = headers[headerName];
      if (!col) return null;
      const v = row.getCell(col).value;
      if (v === null || v === undefined) return null;
      if (typeof v === "object" && v.text) return String(v.text).trim();
      return v;
    };

    // Convierte Date/serial/string a YYYY-MM-DD
    const toISODate = (value) => {
      if (!value) return null;

      if (value instanceof Date) return value.toISOString().slice(0, 10);

      if (typeof value === "number") {
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const d = new Date(excelEpoch.getTime() + value * 86400000);
        return d.toISOString().slice(0, 10);
      }

      const s = String(value).trim();

      // YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

      // DD/MM/YYYY o DD-MM-YYYY
      const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (m) {
        const dd = String(m[1]).padStart(2, "0");
        const mm = String(m[2]).padStart(2, "0");
        const yyyy = m[3];
        return `${yyyy}-${mm}-${dd}`;
      }

      return null;
    };

    // Cache contratos (nombre -> id)
    const [contratosDB] = await pool.query("SELECT id, nombre FROM contratos");
    const contratoMap = new Map(contratosDB.map((c) => [c.nombre.toLowerCase(), c.id]));

    let inserted = 0;
    let historialInserted = 0;
    const errors = [];

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);

      const contratoName = String(getCell(row, "Contrato") ?? "").trim();
      const responsable = String(getCell(row, "Responsable") ?? "").trim();
      const compromiso = String(getCell(row, "Compromiso") ?? "").trim();

      // Saltar fila vacía
      if (!contratoName && !responsable && !compromiso) continue;

      const fechaCreacion = toISODate(getCell(row, "Fecha Creación")) || todayISO();

      // fecha_entrega acordada
      const fechaEntregaAcordada = toISODate(getCell(row, "Fecha Entrega (Acordada)"));

      // reprogramación (solo para estado + historial)
      const nuevaFechaReprog = toISODate(getCell(row, "Nueva Fecha reprogramación"));

      // cierre real
      const fechaCierre = toISODate(getCell(row, "Fecha de Entrega compromiso"));

      // observación finalización
      const observacion = String(getCell(row, "Observación Finalización") ?? "").trim() || null;

      // contador reprogramaciones
      const reprogramacionesRaw = getCell(row, "Reprogramaciones");
      let cantidadReprog = reprogramacionesRaw !== null ? Number(reprogramacionesRaw) : 0;
      if (!Number.isFinite(cantidadReprog)) cantidadReprog = 0;

      // Validación mínima
      if (!contratoName || !responsable || !compromiso || !fechaEntregaAcordada) {
        errors.push({
          fila: r,
          error: "Faltan datos obligatorios (Contrato, Responsable, Compromiso, Fecha Entrega (Acordada))",
        });
        continue;
      }

      // Crear contrato si no existe
      let contratoId = contratoMap.get(contratoName.toLowerCase());
      if (!contratoId) {
        const [ins] = await pool.query(
          "INSERT INTO contratos (nombre, activo) VALUES (?, 1)",
          [contratoName]
        );
        contratoId = ins.insertId;
        contratoMap.set(contratoName.toLowerCase(), contratoId);
      }

      // Estado según reglas
      let estado = "Pendiente";
      if (fechaCierre) estado = "Cerrado";
      else if (nuevaFechaReprog) {
        estado = "Reprogramado";
        if (cantidadReprog === 0) cantidadReprog = 1;
      }

      // Insertar compromiso
      let insertedId = null;

      try {
        const [insComp] = await pool.query(
          `
          INSERT INTO compromisos
            (fecha_creacion, contrato_id, responsable, compromiso, fecha_entrega, estado, cantidad_reprogramaciones, fecha_entrega_compromiso, observacion_general)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            fechaCreacion,
            contratoId,
            responsable,
            compromiso,
            fechaEntregaAcordada,
            estado,
            cantidadReprog,
            fechaCierre,
            observacion,
          ]
        );

        insertedId = insComp.insertId;
        inserted++;
      } catch (e) {
        errors.push({ fila: r, error: e.message });
        continue;
      }

      // Si hay reprogramación: guardar historial (1 registro)
      if (insertedId && nuevaFechaReprog) {
        try {
          await pool.query(
            `
            INSERT INTO historial_reprogramaciones
              (compromiso_id, fecha_anterior, nueva_fecha)
            VALUES
              (?, ?, ?)
            `,
            [insertedId, fechaEntregaAcordada, nuevaFechaReprog]
          );
          historialInserted++;
        } catch (e) {
          errors.push({
            fila: r,
            error: `Compromiso insertado (ID ${insertedId}) pero no se pudo insertar historial: ${e.message}`,
          });
        }
      }
    }

    res.json({
      ok: true,
      inserted_compromisos: inserted,
      inserted_historial: historialInserted,
      errors_count: errors.length,
      errors: errors.slice(0, 50),
    });
  } catch (err) {
    console.error("Error import:", err);
    res.status(500).json({ error: "Error importando Excel" });
  }
});

// =========================================================
//  BORRADO (individual / masivo)
// =========================================================

/**
 * DELETE /compromisos/:id
 * Elimina un compromiso + su evidencia (si existe)
 */
app.delete("/compromisos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });

    // 1) Borrar evidencia si existe
    const [ev] = await pool.query(
      "SELECT filename FROM evidencias WHERE compromiso_id = ? LIMIT 1",
      [id]
    );
    if (ev.length) {
      const f = path.join(UPLOAD_DIR, ev[0].filename);
      await pool.query("DELETE FROM evidencias WHERE compromiso_id = ?", [id]);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }

    // 2) Borrar compromiso
    const [del] = await pool.query("DELETE FROM compromisos WHERE id = ?", [id]);

    res.json({ ok: true, deleted: del.affectedRows });
  } catch (err) {
    console.error("Error DELETE /compromisos/:id:", err);
    res.status(500).json({ error: "Error eliminando compromiso" });
  }
});

/**
 * POST /compromisos/delete-bulk
 * Body: { ids: [1,2,3] }
 * Elimina evidencias + archivos y luego compromisos.
 */
app.post("/compromisos/delete-bulk", async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids)
      ? req.body.ids.map(Number).filter(Boolean)
      : [];

    if (!ids.length) return res.status(400).json({ error: "ids es obligatorio" });

    // 1) Buscar evidencias para borrarlas físicamente
    const [evs] = await pool.query(
      `SELECT compromiso_id, filename FROM evidencias WHERE compromiso_id IN (${ids.map(() => "?").join(",")})`,
      ids
    );

    // 2) Borrar registros evidencia + archivos
    if (evs.length) {
      await pool.query(
        `DELETE FROM evidencias WHERE compromiso_id IN (${ids.map(() => "?").join(",")})`,
        ids
      );

      for (const e of evs) {
        const f = path.join(UPLOAD_DIR, e.filename);
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
    }

    // 3) Borrar compromisos
    const [del] = await pool.query(
      `DELETE FROM compromisos WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids
    );

    res.json({ ok: true, deleted_count: del.affectedRows });
  } catch (err) {
    console.error("Error POST /compromisos/delete-bulk:", err);
    res.status(500).json({ error: "Error eliminando en lote" });
  }
});

// =========================================================
//  ARRANQUE
// =========================================================

  const PORT = process.env.PORT || 3000;

initDB()
  .then(() => app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`)))
  .catch((e) => {
    console.error("❌ No se pudo conectar a MySQL:", e.message);
    process.exit(1);
  });