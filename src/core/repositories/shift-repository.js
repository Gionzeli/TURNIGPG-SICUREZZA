import { BaseRepository } from "./base-repository.js";

export class ShiftRepository extends BaseRepository {
  constructor(options) {
    super({ ...options, storeName: "shifts" });
  }
}
