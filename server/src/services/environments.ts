import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { environmentLeases, environments } from "@paperclipai/db";
import type { Environment, EnvironmentLease, EnvironmentLeasePolicy, EnvironmentLeaseStatus, UpdateEnvironment } from "@paperclipai/shared";
import type { CreateEnvironment } from "@paperclipai/shared";

type EnvironmentRow = typeof environments.$inferSelect;
type EnvironmentLeaseRow = typeof environmentLeases.$inferSelect;
const DEFAULT_LOCAL_ENVIRONMENT_NAME = "Local";
const DEFAULT_LOCAL_ENVIRONMENT_DESCRIPTION =
  "Default execution environment for Paperclip runs on this machine.";

function cloneRecord(value: unknown, fallback: Record<string, unknown> | null = null): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return { ...(value as Record<string, unknown>) };
}

function toEnvironment(row: EnvironmentRow): Environment {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    description: row.description ?? null,
    driver: row.driver as Environment["driver"],
    status: row.status as Environment["status"],
    config: cloneRecord(row.config, {}) ?? {},
    metadata: cloneRecord(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toEnvironmentLease(row: EnvironmentLeaseRow): EnvironmentLease {
  return {
    id: row.id,
    companyId: row.companyId,
    environmentId: row.environmentId,
    executionWorkspaceId: row.executionWorkspaceId ?? null,
    issueId: row.issueId ?? null,
    heartbeatRunId: row.heartbeatRunId ?? null,
    status: row.status as EnvironmentLease["status"],
    leasePolicy: row.leasePolicy as EnvironmentLease["leasePolicy"],
    provider: row.provider ?? null,
    providerLeaseId: row.providerLeaseId ?? null,
    acquiredAt: row.acquiredAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt ?? null,
    releasedAt: row.releasedAt ?? null,
    failureReason: row.failureReason ?? null,
    cleanupStatus: row.cleanupStatus as EnvironmentLease["cleanupStatus"],
    metadata: cloneRecord(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function environmentService(db: Db) {
  return {
    list: async (
      companyId: string,
      filters: {
        status?: string;
        driver?: string;
      } = {},
    ): Promise<Environment[]> => {
      const conditions = [eq(environments.companyId, companyId)];
      if (filters.status) conditions.push(eq(environments.status, filters.status));
      if (filters.driver) conditions.push(eq(environments.driver, filters.driver));
      const rows = await db
        .select()
        .from(environments)
        .where(and(...conditions))
        .orderBy(desc(environments.updatedAt), desc(environments.createdAt));
      return rows.map(toEnvironment);
    },

    getById: async (id: string): Promise<Environment | null> => {
      const row = await db.select().from(environments).where(eq(environments.id, id)).then((rows) => rows[0] ?? null);
      return row ? toEnvironment(row) : null;
    },

    getLeaseById: async (id: string): Promise<EnvironmentLease | null> => {
      const row = await db
        .select()
        .from(environmentLeases)
        .where(eq(environmentLeases.id, id))
        .then((rows) => rows[0] ?? null);
      return row ? toEnvironmentLease(row) : null;
    },

    ensureLocalEnvironment: async (companyId: string): Promise<Environment> => {
      const exactMatch = await db
        .select()
        .from(environments)
        .where(
          and(
            eq(environments.companyId, companyId),
            eq(environments.driver, "local"),
            eq(environments.status, "active"),
            eq(environments.name, DEFAULT_LOCAL_ENVIRONMENT_NAME),
          ),
        )
        .orderBy(desc(environments.updatedAt), desc(environments.createdAt))
        .then((rows) => rows[0] ?? null);
      if (exactMatch) {
        return toEnvironment(exactMatch);
      }

      const anyActiveLocal = await db
        .select()
        .from(environments)
        .where(
          and(
            eq(environments.companyId, companyId),
            eq(environments.driver, "local"),
            eq(environments.status, "active"),
          ),
        )
        .orderBy(desc(environments.updatedAt), desc(environments.createdAt))
        .then((rows) => rows[0] ?? null);
      if (anyActiveLocal) {
        return toEnvironment(anyActiveLocal);
      }

      return await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(environments)
          .where(
            and(
              eq(environments.companyId, companyId),
              eq(environments.driver, "local"),
              eq(environments.status, "active"),
            ),
          )
          .orderBy(desc(environments.updatedAt), desc(environments.createdAt))
          .then((rows) => rows[0] ?? null);
        if (existing) {
          return toEnvironment(existing);
        }

        const now = new Date();
        const created = await tx
          .insert(environments)
          .values({
            companyId,
            name: DEFAULT_LOCAL_ENVIRONMENT_NAME,
            description: DEFAULT_LOCAL_ENVIRONMENT_DESCRIPTION,
            driver: "local",
            status: "active",
            config: {},
            metadata: {
              managedByPaperclip: true,
              defaultForCompany: true,
            },
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .then((rows) => rows[0]);
        return toEnvironment(created);
      });
    },

    create: async (companyId: string, input: CreateEnvironment): Promise<Environment> => {
      const now = new Date();
      const row = await db
        .insert(environments)
        .values({
          companyId,
          name: input.name,
          description: input.description ?? null,
          driver: input.driver,
          status: input.status ?? "active",
          config: input.config ?? {},
          metadata: input.metadata ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .then((rows) => rows[0]);
      return toEnvironment(row);
    },

    update: async (id: string, patch: UpdateEnvironment): Promise<Environment | null> => {
      const values: Partial<typeof environments.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.description !== undefined) values.description = patch.description ?? null;
      if (patch.driver !== undefined) values.driver = patch.driver;
      if (patch.status !== undefined) values.status = patch.status;
      if (patch.config !== undefined) values.config = patch.config;
      if (patch.metadata !== undefined) values.metadata = patch.metadata ?? null;

      const row = await db
        .update(environments)
        .set(values)
        .where(eq(environments.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
      return row ? toEnvironment(row) : null;
    },

    listLeases: async (
      environmentId: string,
      filters: {
        status?: string;
      } = {},
    ): Promise<EnvironmentLease[]> => {
      const conditions = [eq(environmentLeases.environmentId, environmentId)];
      if (filters.status) conditions.push(eq(environmentLeases.status, filters.status));
      const rows = await db
        .select()
        .from(environmentLeases)
        .where(and(...conditions))
        .orderBy(desc(environmentLeases.lastUsedAt), desc(environmentLeases.createdAt));
      return rows.map(toEnvironmentLease);
    },

    acquireLease: async (input: {
      companyId: string;
      environmentId: string;
      executionWorkspaceId?: string | null;
      issueId?: string | null;
      heartbeatRunId?: string | null;
      leasePolicy?: EnvironmentLeasePolicy;
      provider?: string | null;
      providerLeaseId?: string | null;
      expiresAt?: Date | null;
      metadata?: Record<string, unknown> | null;
    }): Promise<EnvironmentLease> => {
      const now = new Date();
      const row = await db
        .insert(environmentLeases)
        .values({
          companyId: input.companyId,
          environmentId: input.environmentId,
          executionWorkspaceId: input.executionWorkspaceId ?? null,
          issueId: input.issueId ?? null,
          heartbeatRunId: input.heartbeatRunId ?? null,
          status: "active",
          leasePolicy: input.leasePolicy ?? "ephemeral",
          provider: input.provider ?? null,
          providerLeaseId: input.providerLeaseId ?? null,
          acquiredAt: now,
          lastUsedAt: now,
          expiresAt: input.expiresAt ?? null,
          releasedAt: null,
          failureReason: null,
          cleanupStatus: null,
          metadata: input.metadata ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .then((rows) => rows[0]);
      return toEnvironmentLease(row);
    },

    releaseLease: async (
      id: string,
      status: Extract<EnvironmentLeaseStatus, "released" | "expired" | "failed"> = "released",
      options?: {
        failureReason?: string;
        cleanupStatus?: "pending" | "success" | "failed";
      },
    ) => {
      const now = new Date();
      const row = await db
        .update(environmentLeases)
        .set({
          status,
          releasedAt: now,
          lastUsedAt: now,
          updatedAt: now,
          ...(options?.failureReason !== undefined ? { failureReason: options.failureReason } : {}),
          ...(options?.cleanupStatus !== undefined ? { cleanupStatus: options.cleanupStatus } : {}),
        })
        .where(eq(environmentLeases.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
      return row ? toEnvironmentLease(row) : null;
    },

    updateLeaseMetadata: async (
      id: string,
      metadata: Record<string, unknown> | null,
    ): Promise<EnvironmentLease | null> => {
      const row = await db
        .update(environmentLeases)
        .set({
          metadata,
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(environmentLeases.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
      return row ? toEnvironmentLease(row) : null;
    },

    releaseLeasesForRun: async (
      heartbeatRunId: string,
      status: Extract<EnvironmentLeaseStatus, "released" | "expired" | "failed"> = "released",
    ): Promise<EnvironmentLease[]> => {
      const now = new Date();
      const rows = await db
        .update(environmentLeases)
        .set({
          status,
          releasedAt: now,
          lastUsedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(environmentLeases.heartbeatRunId, heartbeatRunId),
            inArray(environmentLeases.status, ["active"]),
          ),
        )
        .returning();
      return rows.map(toEnvironmentLease);
    },
  };
}
