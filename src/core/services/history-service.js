import { DatabaseError, DB_ERROR_CODES } from "../database/database-errors.js";

const ENTITY_LABELS = Object.freeze({
  shift: "Turno",
  profile: "Profilo",
  setting: "Impostazione",
  absence: "Assenza"
});
const ACTION_LABELS = Object.freeze({
  create: "Creato",
  update: "Modificato",
  delete: "Eliminato"
});
const ENTITY_DESCRIPTIONS = Object.freeze({
  shift: { create: "Turno creato", update: "Turno modificato", delete: "Turno eliminato" },
  profile: { create: "Profilo creato", update: "Profilo modificato", delete: "Profilo eliminato" },
  setting: { create: "Impostazione creata", update: "Impostazione modificata", delete: "Impostazione eliminata" },
  absence: { create: "Assenza creata", update: "Assenza modificata", delete: "Assenza eliminata" }
});

function presentEvent(event) {
  const data = event?.data;
  if (!data || !ENTITY_LABELS[data.entityType] || !ACTION_LABELS[data.action] ||
      typeof event.createdAt !== "string" || !Number.isSafeInteger(event.revision)) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Evento storico non valido per la consultazione.");
  }

  return Object.freeze({
    id: event.id,
    occurredAt: event.createdAt,
    entityLabel: ENTITY_LABELS[data.entityType],
    actionLabel: ACTION_LABELS[data.action],
    description: ENTITY_DESCRIPTIONS[data.entityType][data.action],
    revision: event.revision,
    previousRevision: data.previousRevision ?? null,
    newRevision: data.newRevision ?? null
  });
}

export class HistoryService {
  constructor({ repository }) {
    if (!repository) throw new TypeError("HistoryService richiede un repository.");
    this.repository = repository;
  }

  async getRecentEvents(limit = 50) {
    const events = await this.repository.getRecentEvents(limit);
    return Object.freeze(events.map(presentEvent));
  }

  async getEventsForEntity(entityType, entityId) {
    const events = await this.repository.getEventsForEntity(entityType, entityId);
    return Object.freeze(events.map(presentEvent));
  }
}
