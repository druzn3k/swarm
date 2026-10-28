import { spreadsheetUtil } from "../src";

describe("spreadsheetutil", () => {
  it("should do something", () => {
    expect(!!spreadsheetUtil).toBe(true);
  });

  it("sets nested properties", () => {
    expect(spreadsheetUtil.setNested({}, ["one"], "two")).toEqual({ one: "two" });
    expect(spreadsheetUtil.setNested({}, ["one", "two", "three"], "four")).toEqual({
      one: { two: { three: "four" } },
    });
  });

  it("gets nested properties", () => {
    expect(spreadsheetUtil.getNested({ one: { two: "three" } }, ["one", "two"])).toEqual("three");
  });

  it("normalizes single rows", () => {
    expect(spreadsheetUtil.normalizeRow({ one: "two" })).toEqual({ one: "two" });
    expect(spreadsheetUtil.normalizeRow({ one: "two", three: "four" })).toEqual({
      one: "two",
      three: "four",
    });
    expect(spreadsheetUtil.normalizeRow({ one: "two", "three.four.five": "six" })).toEqual({
      one: "two",
      three: { four: { five: "six" } },
    });
  });

  it("normalizes multiple rows", () => {
    expect(spreadsheetUtil.normalizeRows([])).toEqual([]);
    expect(spreadsheetUtil.normalizeRows([{ one: "two" }])).toEqual([{ one: "two" }]);
    expect(
      spreadsheetUtil.normalizeRows([{ one: "two" }, { one: "two", "three.four.five": "six" }])
    ).toEqual([{ one: "two" }, { one: "two", three: { four: { five: "six" } } }]);
  });

  it("groups rows", () => {
    expect(
      spreadsheetUtil.groupRows({ name: "list" }, [
        { name: "bob", list: "one", label: "Bob" },
        { name: "bob", list: "two" },
        { name: "jim", list: "" },
      ])
    ).toEqual([
      { name: "bob", list: ["one", "two"], label: "Bob" },
      { name: "jim", list: [] },
    ]);
    expect(
      spreadsheetUtil.groupRows({ name: ["list", "list2"] }, [
        { name: "bob", list: "one", list2: "three", label: "Bob" },
        { name: "bob", list: "two", list2: "four" },
        { name: "bob", list: "" },
        { name: "jim", list: "" },
      ])
    ).toEqual([
      { name: "bob", list: ["one", "two"], list2: ["three", "four"], label: "Bob" },
      { name: "jim", list: [], list2: [] },
    ]);
  });

  it("resolves refs", () => {
    const a = { ref: "x" };
    spreadsheetUtil.resolveList([a], "ref", { x: 1 });
    expect(a.ref).toBe(1);
    expect(() => spreadsheetUtil.resolveList([{ ref: "y" }], "ref", { x: 1 })).toThrow();
    const b = { ref: "y" };
    spreadsheetUtil.resolveList([b], "ref", { x: 1 }, { required: false });
    expect(b.ref).toBeUndefined();
  });
});
