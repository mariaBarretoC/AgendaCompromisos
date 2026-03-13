/**
 * server.js - Agenda de Compromisos (Empresa)
 *
 * Incluye:
 * - CRUD de contratos y compromisos
 * - Filtros avanzados:
 *    - contrato_id
 *    - responsable (LIKE)
 *    - atrasado (1/0)
 *    - multi-estado
 *    - filtro fecha único (día/mes)
 * - Exportar Excel con filtros
 * - Importar Excel (xlsx) a BD
 * - Evidencias en Cloudinary (1 imagen por compromiso)
 * - Eliminar compromisos (individual / masivo)
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const ExcelJS = require("exceljs");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

const app = express();

// =========================================================
//  CONFIGURACIÓN GLOBAL
// =========================================================

/**
 * Cloudinary:
 * aquí se configura con variables de entorno.
 * Estas variables deben existir en:
 * - tu archivo .env local
 * - Render (Environment Variables)
 */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Lista de orígenes permitidos para consumir la API.
 * Aquí permitimos:
 * - tu frontend publicado en Cloudflare Pages
 * - pruebas locales en Live Server / localhost
 */
const allowedOrigins = [
  "https://agendacompromisos.pages.dev",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
];

/**
 * Middleware CORS:
 * - si el request viene de un origen permitido, entra
 * - si no tiene origin (ej. Postman, curl), también entra
 */
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS bloqueado: " + origin));
  },
  credentials: false,
}));

/**
 * Permite que Express entienda JSON en req.body
 */
app.use(express.json());

// =========================================================
//  CONFIGURACIÓN MYSQL
// =========================================================

/**
 * Configuración de BD:
 * - local usa tus variables .env
 * - producción usa variables de Render
 */
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "agenda_compromisos",
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
};

let pool;

/**
 * Inicializa el pool de conexiones MySQL.
 * pool permite reutilizar conexiones y es más eficiente.
 */
async function initDB() {
  pool = await mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  await pool.query("SELECT 1");
  console.log("✅ Conectado a MySQL");
}

// =========================================================
//  HELPERS GENERALES
// =========================================================

/**
 * Retorna la fecha de hoy en formato YYYY-MM-DD
 */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Valida fecha tipo YYYY-MM-DD
 */
function isISODate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Valida mes tipo YYYY-MM
 */
function isISOMonth(value) {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

/**
 * Sube un buffer de imagen a Cloudinary.
 * Se usa cuando el usuario carga una evidencia.
 */
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

// =========================================================
//  SALUD
// =========================================================

/**
 * Ruta simple para verificar que la API está viva
 */
app.get("/", (req, res) => {
  res.send("API Agenda OK ✅");
});

// =========================================================
//  MULTER (SUBIDA DE ARCHIVOS)
// =========================================================

/**
 * Filtro: solo imágenes válidas
 */
function fileFilterImagen(req, file, cb) {
  const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
  if (!ok) return cb(new Error("Solo se permiten imágenes JPG, PNG o WEBP"), false);
  cb(null, true);
}

/**
 * Multer para evidencias:
 * - usa memoria (buffer)
 * - luego subimos ese buffer a Cloudinary
 */
const uploadEvidencia = multer({
  storage: multer.memoryStorage(),
  fileFilter: fileFilterImagen,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

/**
 * Multer para importar Excel
 */
const uploadExcel = multer({
  storage: multer.memoryStorage(),
});

// =========================================================
//  CONTRATOS
// =========================================================

/**
 * GET /contratos
 * Retorna contratos activos para poblar selects
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
 * Crea un contrato nuevo
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

    res.status(201).json({
      id: result.insertId,
      nombre: clean,
      activo: 1,
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Ese contrato ya existe" });
    }

    console.error("Error POST /contratos:", err);
    res.status(500).json({ error: "Error creando contrato" });
  }
});

// =========================================================
//  FILTROS
// =========================================================

/**
 * Soporta estado múltiple:
 * - estado=Pendiente&estado=Reprogramado
 * - estado=Pendiente,Reprogramado
 */
function normalizeEstadoMulti(q) {
  const raw = q.estado;
  let list = [];

  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string" && raw.includes(",")) list = raw.split(",");
  else if (typeof raw === "string" && raw.trim()) list = [raw];

  const allowed = new Set(["Pendiente", "Reprogramado", "Cerrado"]);
  return list.map((s) => String(s).trim()).filter((s) => allowed.has(s));
}

/**
 * Aplica filtro de fecha único:
 * - date_field = creacion|entrega|cierre|reprog
 * - date_mode = day|month
 * - date_value = YYYY-MM-DD o YYYY-MM
 */
function applySingleDateFilter(query, where, params) {
  const date_field = String(query.date_field || "").trim();
  const date_mode = String(query.date_mode || "").trim();
  const date_value = String(query.date_value || "").trim();

  if (!date_field || !date_value) return null;

  const validField = new Set(["creacion", "entrega", "cierre", "reprog"]);
  const validMode = new Set(["day", "month"]);

  if (!validField.has(date_field)) {
    return { error: "date_field inválido. Use: creacion|entrega|cierre|reprog" };
  }

  if (!validMode.has(date_mode)) {
    return { error: "date_mode inválido. Use: day|month" };
  }

  let columnSQL = null;
  if (date_field === "creacion") columnSQL = "c.fecha_creacion";
  if (date_field === "entrega") columnSQL = "c.fecha_entrega";
  if (date_field === "cierre") columnSQL = "c.fecha_entrega_compromiso";

  if (date_mode === "day") {
    if (!isISODate(date_value)) {
      return { error: "date_value debe ser YYYY-MM-DD cuando date_mode=day" };
    }

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

    where.push(`DATE(${columnSQL}) = ?`);
    params.push(date_value);
    return null;
  }

  if (date_mode === "month") {
    if (!isISOMonth(date_value)) {
      return { error: "date_value debe ser YYYY-MM cuando date_mode=month" };
    }

    const start = `${date_value}-01`;

    if (date_field === "reprog") {
      where.push(`
        EXISTS (
          SELECT 1
          FROM historial_reprogramaciones hr
          WHERE hr.compromiso_id = c.id
            AND hr.fecha_reprogramacion >= CONCAT(?, ' 00:00:00')
            AND hr.fecha_reprogramacion < CONCAT(DATE_ADD(LAST_DAY(?), INTERVAL 1 DAY), ' 00:00:00')
        )
      `);
      params.push(start, start);
      return null;
    }

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
 * Construye el WHERE dinámico para listados y exportación
 */
function buildFilters(query) {
  const { contrato_id, responsable, atrasado } = query;

  const where = [];
  const params = [];

  if (contrato_id) {
    where.push("c.contrato_id = ?");
    params.push(Number(contrato_id));
  }

  const estados = normalizeEstadoMulti(query);
  if (estados.length) {
    where.push(`c.estado IN (${estados.map(() => "?").join(",")})`);
    params.push(...estados);
  }

  if (responsable && String(responsable).trim()) {
    where.push("c.responsable LIKE ?");
    params.push(`%${String(responsable).trim()}%`);
  }

  if (atrasado === "1") {
    where.push("(c.estado <> 'Cerrado' AND c.fecha_entrega < CURDATE())");
  } else if (atrasado === "0") {
    where.push("NOT (c.estado <> 'Cerrado' AND c.fecha_entrega < CURDATE())");
  }

  const dateErr = applySingleDateFilter(query, where, params);
  if (dateErr?.error) return { error: dateErr.error };

  return { where, params };
}

// =========================================================
//  COMPROMISOS - LISTAR
// =========================================================

/**
 * GET /compromisos
 * Lista compromisos + evidencia si existe
 */
app.get("/compromisos", async (req, res) => {
  try {
    const built = buildFilters(req.query);
    if (built.error) return res.status(400).json({ error: built.error });

    const { where, params } = built;
    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

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

// =========================================================
//  COMPROMISOS - CREAR
// =========================================================

/**
 * POST /compromisos
 * Crea un compromiso nuevo
 */
app.post("/compromisos", async (req, res) => {
  try {
    const { contrato_id, responsable, compromiso, fecha_entrega, observacion_general } = req.body;

    if (!contrato_id || !responsable || !compromiso || !fecha_entrega) {
      return res.status(400).json({
        error: "Faltan campos: contrato_id, responsable, compromiso, fecha_entrega",
      });
    }

    if (!isISODate(fecha_entrega)) {
      return res.status(400).json({ error: "fecha_entrega debe ser YYYY-MM-DD" });
    }

    const [ct] = await pool.query(
      "SELECT id FROM contratos WHERE id = ? AND activo = 1",
      [contrato_id]
    );

    if (ct.length === 0) {
      return res.status(400).json({ error: "Contrato inválido o inactivo" });
    }

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

    const [rows] = await pool.query("SELECT * FROM compromisos WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Error POST /compromisos:", err);
    res.status(500).json({ error: "Error creando compromiso" });
  }
});

// =========================================================
//  COMPROMISOS - REPROGRAMAR
// =========================================================

/**
 * POST /compromisos/:id/reprogramar
 * Reprograma un compromiso, guarda historial y aumenta contador
 */
app.post("/compromisos/:id/reprogramar", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const nueva_fecha = String(req.body?.nueva_fecha || "").trim();

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }

    if (!nueva_fecha) {
      return res.status(400).json({ error: "Faltan datos: nueva_fecha" });
    }

    if (!isISODate(nueva_fecha)) {
      return res.status(400).json({ error: "nueva_fecha debe ser YYYY-MM-DD" });
    }

    const [rows] = await pool.query(
      "SELECT id, fecha_entrega, estado FROM compromisos WHERE id = ?",
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "No existe el compromiso" });
    }

    const comp = rows[0];

    const fechaActual = (comp.fecha_entrega instanceof Date)
      ? comp.fecha_entrega.toISOString().slice(0, 10)
      : String(comp.fecha_entrega).slice(0, 10);

    if (comp.estado === "Cerrado") {
      return res.status(409).json({ error: "El compromiso está Cerrado y no se puede reprogramar" });
    }

    const hoyLocal = new Date();
    hoyLocal.setHours(0, 0, 0, 0);
    const hoy = hoyLocal.toISOString().slice(0, 10);

    if (nueva_fecha < hoy) {
      return res.status(400).json({ error: "No puedes reprogramar a una fecha anterior a hoy" });
    }

    if (nueva_fecha === fechaActual) {
      return res.status(400).json({ error: "La nueva fecha debe ser diferente a la actual" });
    }

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

    const [updated] = await pool.query("SELECT * FROM compromisos WHERE id = ?", [id]);
    return res.json(updated[0]);

  } catch (err) {
    console.error("Error POST /compromisos/:id/reprogramar:", err);
    return res.status(500).json({ error: "Error reprogramando compromiso" });
  }
});

// =========================================================
//  COMPROMISOS - CERRAR
// =========================================================

/**
 * POST /compromisos/:id/cerrar
 * Marca compromiso como cerrado y guarda fecha real
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

// =========================================================
//  COMPROMISOS - HISTORIAL
// =========================================================

/**
 * GET /compromisos/:id/historial
 * Retorna historial de reprogramaciones
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

// =========================================================
//  COMPROMISOS - OBSERVACIÓN
// =========================================================

/**
 * PATCH /compromisos/:id/observacion
 * Guarda o agrega observación general
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
//  EVIDENCIAS - SUBIR
// =========================================================

/**
 * POST /compromisos/:id/evidencia
 * Sube o reemplaza una evidencia en Cloudinary
 */
app.post("/compromisos/:id/evidencia", uploadEvidencia.single("file"), async (req, res) => {
  try {
    const compromisoId = Number(req.params.id);
    if (!compromisoId) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const [compromisos] = await pool.query(
      "SELECT id FROM compromisos WHERE id = ?",
      [compromisoId]
    );

    if (!compromisos.length) {
      return res.status(404).json({ error: "No existe el compromiso" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No se recibió archivo (field: file)" });
    }

    const [prev] = await pool.query(
      "SELECT id, cloudinary_public_id FROM evidencias WHERE compromiso_id = ? LIMIT 1",
      [compromisoId]
    );

    if (prev.length) {
      if (prev[0].cloudinary_public_id) {
        await cloudinary.uploader.destroy(prev[0].cloudinary_public_id);
      }

      await pool.query("DELETE FROM evidencias WHERE id = ?", [prev[0].id]);
    }

    const uploadResult = await uploadBufferToCloudinary(req.file.buffer);

    const url = uploadResult.secure_url;
    const publicId = uploadResult.public_id;

    const [ins] = await pool.query(
      `
      INSERT INTO evidencias
        (compromiso_id, filename, cloudinary_public_id, originalname, mimetype, size, url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        compromisoId,
        publicId,
        publicId,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        url,
      ]
    );

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

// =========================================================
//  EVIDENCIAS - CONSULTAR
// =========================================================

/**
 * GET /compromisos/:id/evidencia
 * Retorna metadata de evidencia
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

// =========================================================
//  EVIDENCIAS - VER
// =========================================================

/**
 * GET /compromisos/:id/evidencia/view
 * Redirige al archivo en Cloudinary
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

// =========================================================
//  EVIDENCIAS - DESCARGAR
// =========================================================

/**
 * GET /compromisos/:id/evidencia/download
 * Redirige al archivo en Cloudinary
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

// =========================================================
//  EVIDENCIAS - ELIMINAR
// =========================================================

/**
 * DELETE /compromisos/:id/evidencia
 * Elimina evidencia de Cloudinary + BD
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

    if (rows[0].cloudinary_public_id) {
      await cloudinary.uploader.destroy(rows[0].cloudinary_public_id);
    }

    await pool.query("DELETE FROM evidencias WHERE id = ?", [rows[0].id]);

    res.json({ ok: true, deleted: 1 });
  } catch (err) {
    console.error("Error DELETE /compromisos/:id/evidencia:", err);
    res.status(500).json({ error: "Error eliminando evidencia" });
  }
});

// =========================================================
//  EXPORT EXCEL
// =========================================================

/**
 * GET /compromisos/export
 * Exporta compromisos filtrados a Excel
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
//  IMPORT EXCEL
// =========================================================

/**
 * POST /compromisos/import
 * Importa archivo Excel a la base de datos
 */
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
      if (!headers[r]) {
        return res.status(400).json({ error: `Falta columna requerida: "${r}"` });
      }
    }

    const getCell = (row, headerName) => {
      const col = headers[headerName];
      if (!col) return null;

      const v = row.getCell(col).value;
      if (v === null || v === undefined) return null;
      if (typeof v === "object" && v.text) return String(v.text).trim();

      return v;
    };

    const toISODate = (value) => {
      if (!value) return null;

      if (value instanceof Date) return value.toISOString().slice(0, 10);

      if (typeof value === "number") {
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const d = new Date(excelEpoch.getTime() + value * 86400000);
        return d.toISOString().slice(0, 10);
      }

      const s = String(value).trim();

      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

      const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (m) {
        const dd = String(m[1]).padStart(2, "0");
        const mm = String(m[2]).padStart(2, "0");
        const yyyy = m[3];
        return `${yyyy}-${mm}-${dd}`;
      }

      return null;
    };

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

      if (!contratoName && !responsable && !compromiso) continue;

      const fechaCreacion = toISODate(getCell(row, "Fecha Creación")) || todayISO();
      const fechaEntregaAcordada = toISODate(getCell(row, "Fecha Entrega (Acordada)"));
      const nuevaFechaReprog = toISODate(getCell(row, "Nueva Fecha reprogramación"));
      const fechaCierre = toISODate(getCell(row, "Fecha de Entrega compromiso"));
      const observacion = String(getCell(row, "Observación Finalización") ?? "").trim() || null;

      const reprogramacionesRaw = getCell(row, "Reprogramaciones");
      let cantidadReprog = reprogramacionesRaw !== null ? Number(reprogramacionesRaw) : 0;
      if (!Number.isFinite(cantidadReprog)) cantidadReprog = 0;

      if (!contratoName || !responsable || !compromiso || !fechaEntregaAcordada) {
        errors.push({
          fila: r,
          error: "Faltan datos obligatorios (Contrato, Responsable, Compromiso, Fecha Entrega (Acordada))",
        });
        continue;
      }

      let contratoId = contratoMap.get(contratoName.toLowerCase());
      if (!contratoId) {
        const [ins] = await pool.query(
          "INSERT INTO contratos (nombre, activo) VALUES (?, 1)",
          [contratoName]
        );
        contratoId = ins.insertId;
        contratoMap.set(contratoName.toLowerCase(), contratoId);
      }

      let estado = "Pendiente";
      if (fechaCierre) estado = "Cerrado";
      else if (nuevaFechaReprog) {
        estado = "Reprogramado";
        if (cantidadReprog === 0) cantidadReprog = 1;
      }

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
//  ELIMINAR COMPROMISO INDIVIDUAL
// =========================================================

/**
 * DELETE /compromisos/:id
 * Elimina compromiso + su evidencia en Cloudinary si existe
 */
app.delete("/compromisos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });

    const [ev] = await pool.query(
      "SELECT id, cloudinary_public_id FROM evidencias WHERE compromiso_id = ? LIMIT 1",
      [id]
    );

    if (ev.length) {
      if (ev[0].cloudinary_public_id) {
        await cloudinary.uploader.destroy(ev[0].cloudinary_public_id);
      }

      await pool.query("DELETE FROM evidencias WHERE compromiso_id = ?", [id]);
    }

    const [del] = await pool.query("DELETE FROM compromisos WHERE id = ?", [id]);

    res.json({ ok: true, deleted: del.affectedRows });
  } catch (err) {
    console.error("Error DELETE /compromisos/:id:", err);
    res.status(500).json({ error: "Error eliminando compromiso" });
  }
});

// =========================================================
//  ELIMINAR COMPROMISOS MASIVO
// =========================================================

/**
 * POST /compromisos/delete-bulk
 * Elimina varios compromisos + evidencias en Cloudinary
 */
app.post("/compromisos/delete-bulk", async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids)
      ? req.body.ids.map(Number).filter(Boolean)
      : [];

    if (!ids.length) {
      return res.status(400).json({ error: "ids es obligatorio" });
    }

    const [evs] = await pool.query(
      `SELECT compromiso_id, cloudinary_public_id
       FROM evidencias
       WHERE compromiso_id IN (${ids.map(() => "?").join(",")})`,
      ids
    );

    for (const e of evs) {
      if (e.cloudinary_public_id) {
        await cloudinary.uploader.destroy(e.cloudinary_public_id);
      }
    }

    if (evs.length) {
      await pool.query(
        `DELETE FROM evidencias WHERE compromiso_id IN (${ids.map(() => "?").join(",")})`,
        ids
      );
    }

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
//  ARRANQUE DEL SERVIDOR
// =========================================================

/**
 * Render asigna PORT automáticamente.
 * En local usa 3000.
 */
const PORT = process.env.PORT || 3000;

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Servidor en puerto ${PORT}`);
    });
  })
  .catch((e) => {
    console.error("❌ No se pudo conectar a MySQL:", e.message);
    process.exit(1);
  });