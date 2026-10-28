import { describe, expect, it } from "vitest";
import { href, parseHash, parseQuery } from "./router";

describe("router", () => {
  it("parses routes", () => {
    expect(parseHash("#/tab/larva")).toEqual({ name: "tab", tab: "larva" });
    expect(parseHash("#/unit/drone")).toEqual({ name: "unit", unit: "drone" });
    expect(parseHash("#/unit/greater%20queen")).toEqual({ name: "unit", unit: "greater queen" });
    expect(parseHash("#/tab/meat/unit/queen")).toEqual({ name: "unit", unit: "queen" });
    expect(parseHash("#/achievements")).toEqual({ name: "achievements" });
    expect(parseHash("#/about")).toEqual({ name: "about" });
    expect(parseHash("#/unit/drone?num=10")).toEqual({ name: "unit", unit: "drone" });
  });
  it("falls back to the meat tab", () => {
    for (const h of ["", "#", "#/", "#/nope", "#/tab", "#/unit", "#/about/x"]) {
      expect(parseHash(h)).toEqual({ name: "tab", tab: "meat" });
    }
  });
  it("builds hrefs that parse back", () => {
    for (const r of [parseHash("#/tab/energy"), parseHash("#/unit/greater%20queen"), parseHash("#/options")]) {
      expect(parseHash(href(r))).toEqual(r);
    }
  });
  it("reads query parameters", () => {
    expect(parseQuery("#/unit/drone?num=%40100").get("num")).toBe("@100");
    expect(parseQuery("#/unit/drone").get("num")).toBeNull();
  });
});
