import { Router } from "../lib/safe-router.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  FIELD_TYPES,
  listCustomFields,
  createCustomField,
  updateCustomField,
  deleteCustomField,
  reorderCustomFields,
} from "../storage/custom-fields-repo.js";

export const customFieldsRouter = Router();
customFieldsRouter.use(requireAuth());

// Todo mundo LÊ (para preencher o lead e para o agente saber o que coletar);
// só admin define o schema — mesma divisão de etapas e respostas rápidas.
function broadcast(req, customFields) {
  const io = req.app.get("io");
  if (io) io.emit("custom-fields:update", { customFields });
}

customFieldsRouter.get("/", async (_req, res) => {
  res.json(await listCustomFields());
});

customFieldsRouter.post("/", requireAuth({ admin: true }), async (req, res) => {
  const label = String(req.body?.label || "").trim();
  if (!label) return res.status(400).json({ error: "label é obrigatório" });
  const type = req.body?.type;
  if (type && !FIELD_TYPES.includes(type)) {
    return res.status(400).json({ error: `type deve ser um de: ${FIELD_TYPES.join(", ")}` });
  }
  if (type === "lista" && !(req.body?.options || []).filter(o => String(o).trim()).length) {
    return res.status(400).json({ error: "campo do tipo lista precisa de ao menos uma opção" });
  }
  const field = await createCustomField({
    label,
    type,
    options: req.body?.options,
    required: req.body?.required,
  });
  broadcast(req, await listCustomFields());
  res.status(201).json(field);
});

customFieldsRouter.patch("/:id", requireAuth({ admin: true }), async (req, res) => {
  const type = req.body?.type;
  if (type && !FIELD_TYPES.includes(type)) {
    return res.status(400).json({ error: `type deve ser um de: ${FIELD_TYPES.join(", ")}` });
  }
  const updated = await updateCustomField(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "campo não encontrado" });
  broadcast(req, await listCustomFields());
  res.json(updated);
});

customFieldsRouter.post("/reorder", requireAuth({ admin: true }), async (req, res) => {
  const customFields = await reorderCustomFields(req.body?.orderedIds);
  broadcast(req, customFields);
  res.json(customFields);
});

customFieldsRouter.delete("/:id", requireAuth({ admin: true }), async (req, res) => {
  const removed = await deleteCustomField(req.params.id);
  if (!removed) return res.status(404).json({ error: "campo não encontrado" });
  const customFields = await listCustomFields();
  broadcast(req, customFields);
  res.json({ ok: true, customFields });
});
