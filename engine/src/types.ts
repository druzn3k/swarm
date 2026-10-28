// Convenience: build all type tables from the spreadsheet, in the same
// dependency order as the old Angular injector
// (effecttypes -> unittypes -> upgradetypes -> achievements).
import { spreadsheet as defaultSpreadsheet } from "./data";
import { SeedRand } from "./seedrand";
import { SeedSession } from "./interfaces";
import { buildEffectTypes, EffectTypes } from "./effecttypes";
import { buildUnitTypes, UnitTypes } from "./unittypes";
import { buildUpgradeTypes, UpgradeTypes } from "./upgradetypes";
import { buildAchievementTypes, AchievementTypes } from "./achievementtypes";

export interface TypeTables {
  seedrand: SeedRand;
  effecttypes: EffectTypes;
  unittypes: UnitTypes;
  upgradetypes: UpgradeTypes;
  achievements: AchievementTypes;
}

export function buildTypes(
  session: SeedSession,
  spreadsheet: any = defaultSpreadsheet()
): TypeTables {
  const seedrand = new SeedRand(session);
  const effecttypes = buildEffectTypes(seedrand);
  const unittypes = buildUnitTypes(effecttypes, spreadsheet);
  const upgradetypes = buildUpgradeTypes(unittypes, effecttypes, spreadsheet);
  const achievements = buildAchievementTypes(spreadsheet, unittypes, upgradetypes);
  return { seedrand, effecttypes, unittypes, upgradetypes, achievements };
}
