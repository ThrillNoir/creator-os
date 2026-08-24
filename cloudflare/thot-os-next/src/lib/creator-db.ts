import "server-only";

type BoundValue = string | number | null | ArrayBuffer;

function compileCreatorScope(sql: string, creatorId: string, values: BoundValue[]) {
  if (!sql.includes("@creator")) throw new Error("Creator-scoped SQL must contain the @creator boundary.");
  let valueIndex = 0;
  const bound: BoundValue[] = [];
  const statement = sql.replace(/@creator|\?/g, (token) => {
    bound.push(token === "@creator" ? creatorId : values[valueIndex++]);
    return "?";
  });
  if (valueIndex !== values.length || bound.some((value) => value === undefined)) throw new Error("Creator-scoped SQL bindings do not match the statement.");
  return { statement, bound };
}

export function creatorPrepare(db: D1Database, creatorId: string, sql: string) {
  const prepare = (values: BoundValue[] = []) => {
    const compiled = compileCreatorScope(sql, creatorId, values);
    return db.prepare(compiled.statement).bind(...compiled.bound);
  };
  return {
    bind: (...values: BoundValue[]) => prepare(values),
    first: <T>() => prepare().first<T>(),
    all: <T>() => prepare().all<T>(),
    run: () => prepare().run(),
  };
}
