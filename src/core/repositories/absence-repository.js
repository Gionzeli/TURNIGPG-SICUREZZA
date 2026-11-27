import { BaseRepository } from "./base-repository.js";

export class AbsenceRepository extends BaseRepository {
  constructor(options) {
    super({ ...options, storeName: "absences" });
  }
}
