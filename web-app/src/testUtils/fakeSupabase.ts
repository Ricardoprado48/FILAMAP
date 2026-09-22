export interface FakeQueryCall {
  table: string;
  method: "select" | "update" | "insert" | "delete";
  payload?: any;
  filters: Array<{ col: string; val: any }>;
  order?: { col: string; opts: any };
}

export type FakeSupabaseResolver = (
  call: FakeQueryCall
) => { data: any; error: any };

/**
 * Cliente Supabase falso para testes unitários de services/dataService --
 * registra a query encadeada (table/method/filters) e resolve com o que o
 * teste configurar em `resolver`, sem nenhuma chamada de rede real.
 */
export function createFakeSupabase(resolver: FakeSupabaseResolver) {
  function makeQuery(
    table: string,
    method: FakeQueryCall["method"],
    payload?: any
  ) {
    const call: FakeQueryCall = { table, method, payload, filters: [] };

    const query: any = {
      eq(col: string, val: any) {
        call.filters.push({ col, val });
        return query;
      },
      in(col: string, val: any) {
        call.filters.push({ col, val });
        return query;
      },
      order(col: string, opts: any) {
        call.order = { col, opts };
        return query;
      },
      limit(_n: number) {
        return query;
      },
      select(_cols?: string) {
        return query;
      },
      maybeSingle() {
        return Promise.resolve(resolver(call));
      },
      single() {
        return Promise.resolve(resolver(call));
      },
      then(onFulfilled: any, onRejected?: any) {
        return Promise.resolve(resolver(call)).then(onFulfilled, onRejected);
      },
    };

    return query;
  }

  return {
    from(table: string) {
      return {
        select: (_cols?: string) => makeQuery(table, "select"),
        update: (payload: any) => makeQuery(table, "update", payload),
        insert: (payload: any) => makeQuery(table, "insert", payload),
        delete: () => makeQuery(table, "delete"),
      };
    },
  };
}
