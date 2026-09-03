import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/bootstrap/config.js";

describe("loadConfig", () => {
  it("allows live first-run without preconfigured iLink or model settings", () => {
    const config = loadConfig({
      DRY_RUN: "false",
      ILINK_AUTO_LOGIN: "false",
      PI_MODEL_ID: "",
      PI_LOAD_LOCAL_SKILLS: "true",
      TOOL_HTTP_ENABLED: "true",
      TOOL_HTTP_ALLOWED_HOSTS: "api.example.com, docs.example.com",
      TOOL_SHELL_ENABLED: "true",
    });

    expect(config.dryRun).toBe(false);
    expect(config.pi.modelId).toBe("");
    expect(config.traceRetention).toBe(100);
    expect(config.pi.loadLocalSkills).toBe(true);
    expect(config.tools.httpEnabled).toBe(true);
    expect(config.tools.httpAllowedHosts).toEqual(["api.example.com", "docs.example.com"]);
    expect(config.tools.shellEnabled).toBe(true);
    expect(config.ilink.allowedSenderId).toBe("");
  });

  it("defers stored credential and sender validation to bootstrap", () => {
    const config = loadConfig({
      DRY_RUN: "false",
      ILINK_AUTO_LOGIN: "false",
      PI_MODEL_ID: "gpt-5.6-sol",
    });

    expect(config.ilink.botToken).toBe("");
    expect(config.ilink.allowedSenderId).toBe("");
  });
});
