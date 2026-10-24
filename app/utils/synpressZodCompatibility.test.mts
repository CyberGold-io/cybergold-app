import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
type SetupContext = { observed?: object; result?: unknown; failure?: Error };
type WalletSetup = {
  hash: string;
  fn: (context: SetupContext, page: object) => Promise<void>;
};
type Importer = (file: string) => Promise<WalletSetup>;
let importerPromise: Promise<Importer> | undefined;

function installedImporter() {
  return importerPromise ??= (async () => {
    const entry = require.resolve("@synthetixio/synpress-cache");
    // Loading the actual distribution catches the removed Zod 3 builder at
    // module startup. Its importer is private, so expose its installed body
    // to the fixture without changing the dependency's public API.
    await import(pathToFileURL(entry).href);
    const source = ts.createSourceFile(entry, readFileSync(entry, "utf8"), ts.ScriptTarget.ESNext);
    const schema = source.statements.find((statement) => ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some((declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === "WalletSetupModule"));
    const importer = source.statements.find((statement) => ts.isFunctionDeclaration(statement)
      && statement.name?.text === "importWalletSetupFile");
    assert.ok(schema && importer, "installed Synpress wallet importer is available");
    const consumerRequire = createRequire(entry);
    const { z } = await import(pathToFileURL(consumerRequire.resolve("zod")).href);
    return new Function("z", `${schema.getText(source)}\n${importer.getText(source)}\nreturn importWalletSetupFile;`)(z) as Importer;
  })();
}

async function withSetup(source: string, verify: (file: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "cybergold-synpress-zod-"));
  const file = join(directory, "wallet.setup.mjs");
  try {
    await writeFile(file, source);
    await verify(pathToFileURL(file).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("the installed Synpress importer retains wallet arguments and validates asynchronous results", async () => {
  const importer = await installedImporter();
  await withSetup(`export default { hash: "fixture", fn: async (context, page) => {
    context.observed = page;
    if (context.failure) throw context.failure;
    return context.result;
  } };`, async (file) => {
    const setup = await importer(file);
    assert.equal(setup.hash, "fixture");
    const context: SetupContext = {}, page = { name: "wallet page" };
    assert.equal(await setup.fn(context, page), undefined);
    assert.equal(context.observed, page);
    await assert.rejects(setup.fn({ result: 42 }, page), (error: unknown) =>
      typeof error === "object" && error !== null && "issues" in error && Array.isArray(error.issues));
    const failure = new Error("wallet setup failed");
    await assert.rejects(setup.fn({ failure }, page), (error: unknown) => error === failure);
  });
});

test("the installed Synpress importer rejects malformed wallet setup modules", async () => {
  const importer = await installedImporter();
  for (const source of ["export default { hash: 'fixture', fn: 42 };", "export default { fn: async () => {} };"]) {
    await withSetup(source, async (file) => {
      await assert.rejects(importer(file), /\[ImportWalletSetupFile\] Invalid wallet setup function/);
    });
  }
});
