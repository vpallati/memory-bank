export const MEMORY_FIELDS =
  "id,type,topic,text,source,confidence,created_at,updated_at,superseded_by";
export const PAGE_SIZE = 50;

export function memoryInput(values) {
  const confidence = Number(values.confidence);
  if (!["fact", "episode", "preference", "idea"].includes(values.type)) {
    throw new Error("Choose a valid memory type.");
  }
  for (const [field, limit] of [["topic", 100], ["text", 20000], ["source", 2000]]) {
    if (typeof values[field] !== "string" || !values[field].trim() || values[field].length > limit) {
      throw new Error(`${field} is required and must be at most ${limit} characters.`);
    }
  }
  if (!["number", "string"].includes(typeof values.confidence) || String(values.confidence).trim() === "" ||
      !Number.isInteger(confidence) || confidence < 0 || confidence > 100) {
    throw new Error("Confidence must be a whole number between 0 and 100.");
  }
  return {
    p_type: values.type, p_topic: values.topic.trim(), p_text: values.text.trim(),
    p_source: values.source.trim(), p_confidence: confidence,
  };
}

export function createVaultApi(client) {
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }
  return {
    async list({ history = false, offset = 0 } = {}) {
      let query = client.from("memories").select(MEMORY_FIELDS)
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (!history) query = query.is("superseded_by", null);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    create: (values) => rpc("create_memory", memoryInput(values)),
    revise: (id, values) => rpc("revise_memory", { p_id: id, ...memoryInput(values) }),
    remove: (id) => rpc("delete_memory", { p_id: id }),
    export: () => rpc("export_vault"),
  };
}
