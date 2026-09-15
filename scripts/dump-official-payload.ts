#!/usr/bin/env tsx
/**
 * Dump every official CommunityPayload for both locales (zh / en) as
 * pretty-printed JSON. Paste the output into the `community_listings.payload`
 * column of the migration.
 *
 * Usage: npm run dump:official
 */
import i18n from '../src/i18n';
import { dumpOfficialPayloadsForMigration } from '../src/constants/officialCommunityListings';

async function main(): Promise<void> {
  await dumpOfficialPayloadsForMigration();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});