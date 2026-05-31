// Shared test-support fake of the narrow `@insforge/sdk` database surface the
// live repository depends on (`InsforgeDatabaseLike`). It is deliberately
// minimal and deterministic: rows are snake_case column maps held in memory,
// the chained filters/modifiers the repository uses are supported, and the
// nested `scans.workspace_id` embed filter is resolved by joining child rows to
// their parent scan via `scan_id`. No network, no RLS — consumers exercise the
// repository's APPLICATION-CODE workspace scoping (Requirements 1.4, 21.7).
//
// This is shared by `live-repository.test.ts` (example-based contract tests)
// and `workspace-scoping.property.test.ts` (Property 1) so there is a single
// source of truth for the fake DB instead of two copies.
import type {
  DbResult,
  InsforgeDatabaseLike,
  QueryBuilder,
  TableHandle,
} from "./live-repository";
import type { DbRow } from "./mappers";

interface Filter {
  kind: "eq" | "in" | "lt";
  column: string;
  value?: string;
  values?: readonly string[];
}

/** child table -> { parentTable, foreign key } for nested `parent.col` filters. */
const PARENT_OF: Record<string, { table: string; fk: string }> = {
  snapshots: { table: "scans", fk: "scan_id" },
  diffs: { table: "scans", fk: "scan_id" },
  claims: { table: "scans", fk: "scan_id" },
};

export class FakeDatabase implements InsforgeDatabaseLike {
  readonly tables: Record<string, DbRow[]> = {};
  /** Records the rows passed to every insert/upsert, to assert array form. */
  readonly insertCalls: { table: string; rows: DbRow[] }[] = [];
  private seq = 0;

  private store(table: string): DbRow[] {
    return (this.tables[table] ??= []);
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private now(): string {
    this.seq += 1;
    // Monotonic ISO timestamps so created_at ordering is deterministic.
    return new Date(Date.UTC(2024, 0, 1, 0, 0, this.seq)).toISOString();
  }

  /** Default columns applied on insert per table. */
  private withDefaults(table: string, row: DbRow): DbRow {
    const created = this.now();
    const base: DbRow = { id: this.nextId(table), created_at: created, ...row };
    if (table === "scans") {
      base.updated_at = base.updated_at ?? created;
      base.trigger_type = base.trigger_type ?? "manual";
    }
    if (table === "workspaces") {
      // is_demo column exists in DB schema; always false.
      base.is_demo = base.is_demo ?? false;
    }
    return base;
  }

  from(table: string): TableHandle {
    return {
      select: (): QueryBuilder => new FakeQueryBuilder(this, table, "select"),
      insert: (rows: DbRow[]): QueryBuilder => {
        this.insertCalls.push({ table, rows });
        const inserted = rows.map((row) => {
          const full = this.withDefaults(table, row);
          this.store(table).push(full);
          return full;
        });
        return new FakeQueryBuilder(this, table, "select", [...inserted]);
      },
      update: (values: DbRow): QueryBuilder =>
        new FakeQueryBuilder(this, table, "update", undefined, values),
      upsert: (rows: DbRow[], options?: { onConflict?: string }): QueryBuilder => {
        this.insertCalls.push({ table, rows });
        const conflictCols = (options?.onConflict ?? "id").split(",");
        const affected = rows.map((row) => {
          const existing = this.store(table).find((candidate) =>
            conflictCols.every((col) => candidate[col] === row[col]),
          );
          if (existing) {
            Object.assign(existing, row);
            return existing;
          }
          const full = this.withDefaults(table, row);
          this.store(table).push(full);
          return full;
        });
        return new FakeQueryBuilder(this, table, "select", [...affected]);
      },
      delete: (): QueryBuilder => new FakeQueryBuilder(this, table, "delete"),
    };
  }

  /** Apply a single filter to the current candidate rows. */
  matches(table: string, row: DbRow, filter: Filter): boolean {
    const { column } = filter;
    if (column.includes(".")) {
      const [parentName, parentCol] = column.split(".");
      const parent = PARENT_OF[table];
      if (!parent || parent.table !== parentName) {
        return false;
      }
      const parentRow = this.store(parent.table).find(
        (candidate) => candidate.id === row[parent.fk],
      );
      if (!parentRow) {
        return false;
      }
      return this.compare(parentRow[parentCol as string], filter);
    }
    return this.compare(row[column], filter);
  }

  private compare(actual: unknown, filter: Filter): boolean {
    switch (filter.kind) {
      case "eq":
        return String(actual) === filter.value;
      case "in":
        return (filter.values ?? []).includes(String(actual));
      case "lt":
        return String(actual) < String(filter.value);
    }
  }
}

class FakeQueryBuilder implements QueryBuilder {
  private readonly filters: Filter[] = [];
  private orderSpec?: { column: string; ascending: boolean };
  private limitN?: number;

  constructor(
    private readonly db: FakeDatabase,
    private readonly table: string,
    private readonly op: "select" | "update" | "delete",
    private readonly preset?: DbRow[],
    private readonly updateValues?: DbRow,
  ) {}

  select(): QueryBuilder {
    return this;
  }
  eq(column: string, value: string): QueryBuilder {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }
  in(column: string, values: readonly string[]): QueryBuilder {
    this.filters.push({ kind: "in", column, values });
    return this;
  }
  lt(column: string, value: string): QueryBuilder {
    this.filters.push({ kind: "lt", column, value });
    return this;
  }
  order(column: string, options: { ascending: boolean }): QueryBuilder {
    this.orderSpec = { column, ascending: options.ascending };
    return this;
  }
  limit(count: number): QueryBuilder {
    this.limitN = count;
    return this;
  }

  private cascadeDelete(parentTable: string, removedParentIds: Set<string>): void {
    // Mirror `ON DELETE CASCADE`: deleting a company removes its watched_sources
    // (and, transitively, would remove scans etc. — only the relationships the
    // tests rely on are modelled here).
    if (parentTable === "companies") {
      this.db.tables.watched_sources = (
        this.db.tables.watched_sources ?? []
      ).filter((row) => !removedParentIds.has(String(row.company_id)));
    }
  }

  private run(): DbRow[] {
    // A preset (insert/upsert result) bypasses filtering.
    if (this.preset) {
      return this.preset;
    }
    const all = this.db.tables[this.table] ?? [];
    let rows = all.filter((row) =>
      this.filters.every((filter) => this.db.matches(this.table, row, filter)),
    );
    if (this.op === "update" && this.updateValues) {
      rows.forEach((row) => Object.assign(row, this.updateValues));
    }
    if (this.op === "delete") {
      // Remove the matched rows from the backing store, then cascade to child
      // tables whose FK is `ON DELETE CASCADE` in the live schema (so the fake
      // mirrors the real delete behaviour relied on for atomic rollback).
      const removedIds = new Set(rows.map((row) => String(row.id)));
      this.db.tables[this.table] = (this.db.tables[this.table] ?? []).filter(
        (row) => !removedIds.has(String(row.id)),
      );
      this.cascadeDelete(this.table, removedIds);
      return rows;
    }
    if (this.orderSpec) {
      const { column, ascending } = this.orderSpec;
      rows = [...rows].sort((a, b) => {
        const av = String(a[column]);
        const bv = String(b[column]);
        return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    if (this.limitN !== undefined) {
      rows = rows.slice(0, this.limitN);
    }
    return rows;
  }

  then<TResult1 = DbResult<DbRow[]>, TResult2 = never>(
    onfulfilled?:
      | ((value: DbResult<DbRow[]>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve<DbResult<DbRow[]>>({ data: this.run(), error: null }).then(
      onfulfilled,
      onrejected,
    );
  }

  maybeSingle(): PromiseLike<DbResult<DbRow>> {
    const rows = this.run();
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
}
