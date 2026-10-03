export function sample() {
  return {
    schema_version: "1",
    suite_id: "fixture",
    name: "固定测试",
    source_refs: [
      {
        id: "r",
        kind: "user",
        uri: "user:test",
        version: "1",
        locator: "输入",
        excerpt: "点赞不为0",
      },
    ],
    cases: [
      {
        case_id: "one",
        name: "测试",
        datasets: [{ data_id: "a", inputs: {}, expected: { likes: 0 } }],
        preconditions: [],
        cleanup: [],
        steps: [
          {
            step_id: "read",
            kind: "action",
            description: "读取",
            required: true,
            depends_on: [],
            action: {
              goal: "读取计数",
              capability: "browser",
              allowed_targets: ["https://example.test"],
              inputs: {},
              outputs: { likes: { type: "number" } },
              completion_requirements: ["likes"],
            },
          },
          {
            step_id: "check",
            kind: "assertion",
            description: "核对",
            required: true,
            depends_on: ["read"],
            assertion: {
              observation_ref: "read.likes",
              operator: "neq",
              expected_ref: "data.expected.likes",
              rule_ref: "r",
            },
          },
        ],
      },
    ],
  };
}
