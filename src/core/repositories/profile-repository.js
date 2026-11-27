import { BaseRepository } from "./base-repository.js";

export class ProfileRepository extends BaseRepository {
  constructor(options) {
    super({ ...options, storeName: "profiles" });
  }
}
