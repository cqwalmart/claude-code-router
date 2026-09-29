import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyClaudeAppGatewayConfig, restoreClaudeAppGatewayConfig } from "@ccr/core/agents/claude-app/gateway-service.ts";
import { CONFIGDIR } from "@ccr/core/config/constants.ts";
import { resolveClaudeAppGatewayRouteModel } from "@ccr/core/agents/claude-app/gateway-routes.ts";

test("Claude App gateway config keeps 3P mode signed out of Claude.ai", () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ccr-claude-app-gateway-config-"));
  const activeDataDir = `${dataDir}-3p`;

  try {
    const { result } = applyClaudeAppGatewayConfig(createConfig(), {
      backup: false,
      dataDir
    });
    const launchRootConfig = readJson(path.join(dataDir, "claude_desktop_config.json"));
    const launchGatewayConfig = readJson(path.join(dataDir, "configLibrary", "8f69f2f1-3275-4ad8-9317-4aa7e972f311.json"));
    const activeRootConfig = readJson(result.configFile);
    const activeGatewayConfig = readJson(result.configLibraryFile);

    assert.equal(result.dataDir, activeDataDir);
    assert.equal(result.configFile, path.join(activeDataDir, "claude_desktop_config.json"));
    assert.equal(result.configLibraryFile, path.join(activeDataDir, "configLibrary", "8f69f2f1-3275-4ad8-9317-4aa7e972f311.json"));

    assert.equal(launchRootConfig.deploymentMode, "3p");
    assert.equal(activeRootConfig.deploymentMode, "3p");
    assert.deepEqual(launchGatewayConfig, activeGatewayConfig);
    assert.deepEqual(activeGatewayConfig.authentication, {
      disableClaudeAiSignIn: true
    });
    assert.equal(activeGatewayConfig.bootstrapEnabled, false);

    assert.equal(activeGatewayConfig.inferenceProvider, "gateway");
    assert.equal(activeGatewayConfig.inferenceCredentialKind, "static");
    assert.equal(activeGatewayConfig.inferenceGatewayAuthScheme, "x-api-key");
    assert.equal(activeGatewayConfig.inferenceGatewayApiKey, "existing-test-key");
    assert.equal(activeGatewayConfig.inferenceGatewayBaseUrl, "http://127.0.0.1:3456");
    assert.equal(activeGatewayConfig.modelDiscoveryEnabled, true);
    assert.equal(activeGatewayConfig.unstableDisableModelVerification, true);
    assert.ok(activeGatewayConfig.inferenceModels.length > 0);
  } finally {
    rmSync(dataDir, { force: true, recursive: true });
    rmSync(activeDataDir, { force: true, recursive: true });
  }
});

test("Claude App gateway config writes the selected default model first", () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ccr-claude-app-gateway-default-"));
  const activeDataDir = `${dataDir}-3p`;
  const config = createConfig({
    Providers: [
      { models: ["first-model"], name: "first-provider" },
      { models: ["selected-model"], name: "selected-provider" }
    ]
  });

  try {
    const { result } = applyClaudeAppGatewayConfig(config, {
      backup: false,
      dataDir,
      defaultModel: "selected-model"
    });
    const activeGatewayConfig = readJson(result.configLibraryFile);
    const firstModel = activeGatewayConfig.inferenceModels[0]?.name;

    assert.equal(
      resolveClaudeAppGatewayRouteModel(firstModel, config, { defaultTargetModel: "selected-model" }),
      "selected-provider/selected-model"
    );
  } finally {
    rmSync(dataDir, { force: true, recursive: true });
    rmSync(activeDataDir, { force: true, recursive: true });
  }
});

test("Claude App gateway config preserves unknown keys when rewriting config library", () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ccr-claude-app-gateway-preserve-"));
  const activeDataDir = `${dataDir}-3p`;
  const configId = "8f69f2f1-3275-4ad8-9317-4aa7e972f311.json";
  const applyOptions = { backup: false, dataDir };

  try {
    const { result } = applyClaudeAppGatewayConfig(createConfig(), applyOptions);
    const launchLibraryFile = path.join(dataDir, "configLibrary", configId);
    const activeLibraryFile = result.configLibraryFile;

    for (const file of [launchLibraryFile, activeLibraryFile]) {
      writeJson(file, {
        ...readJson(file),
        coworkEgressAllowedHosts: ["*"],
        extraUnknownKey: "keep-me"
      });
    }

    applyClaudeAppGatewayConfig(createConfig({
      PORT: 3457,
      gateway: {
        enabled: false,
        host: "0.0.0.0",
        port: 3457
      }
    }), applyOptions);

    for (const file of [launchLibraryFile, activeLibraryFile]) {
      const rewritten = readJson(file);
      assert.deepEqual(rewritten.coworkEgressAllowedHosts, ["*"]);
      assert.equal(rewritten.extraUnknownKey, "keep-me");
      assert.equal(rewritten.inferenceGatewayBaseUrl, "http://127.0.0.1:3457");
      assert.equal(rewritten.inferenceProvider, "gateway");
      assert.equal(rewritten.inferenceGatewayApiKey, "existing-test-key");
    }
  } finally {
    rmSync(dataDir, { force: true, recursive: true });
    rmSync(activeDataDir, { force: true, recursive: true });
  }
});

test("#1768 restore preserves Claude-written preferences and only reverts owned keys", () => {
  const first = applyClaudeAppGatewayConfig(createConfig());
  const rootFile = first.result.configFile;
  const libraryFile = first.result.configLibraryFile;
  const metaFile = path.join(path.dirname(libraryFile), "_meta.json");
  const backupFile = path.join(CONFIGDIR, "claude-app-gateway-backup.json");
  try {
    writeJson(rootFile, { deploymentMode: "native", preference: false });
    writeJson(libraryFile, { inferenceProvider: "original" });
    writeJson(metaFile, { appliedId: "original", entries: [{ id: "original", name: "Original" }] });

    // Takeover keeps the first pre-takeover backup; drop it so the second
    // apply snapshots the seeded originals.
    rmSync(backupFile, { force: true });

    applyClaudeAppGatewayConfig(createConfig());
    assert.equal(readJson(rootFile).deploymentMode, "3p");

    writeJson(rootFile, { ...readJson(rootFile), preference: true });
    writeJson(libraryFile, { ...readJson(libraryFile), chatTabEnabled: true, coworkEgressAllowedHosts: ["example.test"] });
    const meta = readJson(metaFile);
    writeJson(metaFile, { ...meta, userPreference: true, entries: [...(meta.entries ?? []), { id: "new-1", name: "New" }] });

    restoreClaudeAppGatewayConfig();

    assert.equal(readJson(rootFile).deploymentMode, "native");
    assert.equal(readJson(rootFile).preference, true);
    assert.equal(readJson(metaFile).appliedId, "original");
    assert.equal(readJson(metaFile).userPreference, true);
    assert.ok(readJson(metaFile).entries.some((entry) => entry.id === "new-1"));
    assert.equal(readJson(libraryFile).chatTabEnabled, true);
    assert.deepEqual(readJson(libraryFile).coworkEgressAllowedHosts, ["example.test"]);
    assert.equal(existsSync(backupFile), false);
  } finally {
    restoreClaudeAppGatewayConfig();
    rmSync(first.result.dataDir, { force: true, recursive: true });
  }
});

test("#1768 restore removes takeover keys absent from the original while keeping new preferences", () => {
  const { result } = applyClaudeAppGatewayConfig(createConfig());
  const rootFile = result.configFile;
  const metaFile = path.join(path.dirname(result.configLibraryFile), "_meta.json");
  try {
    writeJson(rootFile, { deploymentMode: "3p", userPreference: true });

    restoreClaudeAppGatewayConfig();

    assert.deepEqual(readJson(rootFile), { userPreference: true });
    assert.equal(readJson(metaFile).appliedId, undefined);
    assert.equal(existsSync(result.configLibraryFile), true);
  } finally {
    rmSync(result.dataDir, { force: true, recursive: true });
  }
});

function createConfig(overrides = {}) {
  return {
    APIKEY: "existing-test-key",
    APIKEYS: [],
    HOST: "0.0.0.0",
    PORT: 3456,
    Providers: [{
      models: ["test-model"],
      name: "test-provider"
    }],
    gateway: {
      enabled: false,
      host: "0.0.0.0",
      port: 3456
    },
    profile: {
      profiles: []
    },
    virtualModelProfiles: [],
    ...overrides
  };
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
