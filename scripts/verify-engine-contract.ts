import { verifyEngineContract } from "../src/main/engine-contract-verify";

async function main(): Promise<void> {
  const profile = process.env.HERMES_PROFILE || undefined;
  const result = await verifyEngineContract(profile);
  const broken = result.findings.filter(
    (finding) => finding.verdict === "broken",
  );
  const unknown = result.findings.filter(
    (finding) => finding.verdict === "unknown",
  );

  console.log(
    JSON.stringify(
      {
        status: result.status,
        checkedAt: result.checkedAt,
        findings: result.findings.length,
        broken: broken.length,
        unknown: unknown.length,
      },
      null,
      2,
    ),
  );

  if (broken.length > 0) {
    for (const finding of broken) {
      console.error(`${finding.entryId}: ${finding.detail}`);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
