/**
 * Environments service rules — the product contracts, tested at the service
 * boundary over a fresh mock repository (reset per test for isolation).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { EnvironmentsService } from './environmentsService';
import { getEnvironmentsRepository, resetEnvironmentsRepository } from '../data/environmentsFactory';
import { SEED_ENVIRONMENT_WORKSPACE_ID, SEED_OTHER_WORKSPACE_ID } from '../mock/environmentsSeed';
import type { EnvironmentSpecRecord, EnvironmentVersionRecord } from '../domain/environments';

let service: EnvironmentsService;
let workspaceId: string;
let otherWorkspaceId: string;

beforeEach(() => {
  resetEnvironmentsRepository();
  service = new EnvironmentsService(getEnvironmentsRepository());
  workspaceId = SEED_ENVIRONMENT_WORKSPACE_ID;
  otherWorkspaceId = SEED_OTHER_WORKSPACE_ID;
});

const DEMO_ENV_ID = 'env_warm_bedroom_studio';
const V1_ID = 'env_ver_wbs_v1';
const V2_ID = 'env_ver_wbs_v2';

async function createIsolatedEnvironment(): Promise<{ environmentId: string; versionId: string }> {
  const environment = await service.createEnvironment(
    { workspaceId, name: 'Test Corner Set' },
    'tester',
  );
  const versions = await service.getVersions(environment.id, workspaceId);
  return { environmentId: environment.id, versionId: versions[0].id };
}

describe('rule 1 — locked environment versions cannot be edited', () => {
  it('refuses spec updates through the service', async () => {
    await expect(
      service.updateSpec(V1_ID, { heroAngle: 'straight-on' }, workspaceId),
    ).rejects.toThrow(/locked and cannot be edited/);
  });

  it('refuses locking an already-locked version', async () => {
    await expect(service.lockVersion(V1_ID, workspaceId)).rejects.toThrow(/locked/);
  });

  it('still allows editing the open draft', async () => {
    const spec = await service.updateSpec(V2_ID, { layoutFeel: 'warmer, evening feel' }, workspaceId);
    expect(spec.layoutFeel).toBe('warmer, evening feel');
  });
});

describe('rule 2 — draft-from-locked copies without mutating the source', () => {
  it('copies spec anchors and references, leaving the source intact', async () => {
    const specBefore: EnvironmentSpecRecord = await service.getSpec(V1_ID, workspaceId);
    const refsBefore = await service.getReferences(V1_ID, workspaceId);
    expect(refsBefore.length).toBeGreaterThan(0);

    // Only one draft may exist: lock the seeded open draft (v2) first so the
    // copy from locked v1 is legal under the one-draft rule.
    await service.lockVersion(V2_ID, workspaceId);

    const created: EnvironmentVersionRecord = await service.createVersion(
      {
        environmentId: DEMO_ENV_ID,
        sourceVersionId: V1_ID,
        changeSummary: 'Try stricter anchoring',
      },
      'tester',
      workspaceId,
    );

    expect(created.versionNumber).toBe(3);
    expect(created.status).toBe('draft');

    const copiedSpec = await service.getSpec(created.id, workspaceId);
    expect(copiedSpec.roomType).toBe(specBefore.roomType);
    expect(copiedSpec.heroAngle).toBe(specBefore.heroAngle);
    expect(copiedSpec.furnitureAnchors).toEqual(specBefore.furnitureAnchors);

    const copiedRefs = await service.getReferences(created.id, workspaceId);
    expect(copiedRefs.map((r) => r.storagePath)).toEqual(refsBefore.map((r) => r.storagePath));

    // Source untouched.
    const specAfter = await service.getSpec(V1_ID, workspaceId);
    const refsAfter = await service.getReferences(V1_ID, workspaceId);
    expect(specAfter).toEqual(specBefore);
    expect(refsAfter).toEqual(refsBefore);
  });
});

describe('rule 3 — version numbers increment safely', () => {
  it('assigns max+1 even after mixed histories', async () => {
    // Seed: v1 locked, v2 draft. Lock v2 (v1 becomes superseded), then the
    // next draft must be v3.
    await service.lockVersion(V2_ID, workspaceId);
    const created = await service.createVersion(
      { environmentId: DEMO_ENV_ID, sourceVersionId: V2_ID, changeSummary: 'next' },
      'tester',
      workspaceId,
    );
    expect(created.versionNumber).toBe(3);

    // And after that draft is locked, the following one is v4.
    await service.lockVersion(created.id, workspaceId);
    const fourth = await service.createVersion(
      { environmentId: DEMO_ENV_ID, sourceVersionId: created.id, changeSummary: 'next again' },
      'tester',
      workspaceId,
    );
    expect(fourth.versionNumber).toBe(4);
  });

  it('refuses a second draft while one is open', async () => {
    await expect(
      service.createVersion(
        { environmentId: DEMO_ENV_ID, sourceVersionId: V1_ID, changeSummary: 'dupe' },
        'tester',
        workspaceId,
      ),
    ).rejects.toThrow(/draft version already exists/);
  });
});

describe('rule 4 — cross-workspace access is prevented', () => {
  it('cannot read an environment from another workspace', async () => {
    await expect(
      service.getEnvironment('env_glass_loft', workspaceId),
    ).rejects.toThrow(/Cross-workspace access denied/);
  });

  it('cannot update or lock across workspaces', async () => {
    await expect(
      service.archiveEnvironment('env_glass_loft', workspaceId),
    ).rejects.toThrow(/Cross-workspace access denied/);
    await expect(
      service.updateSpec('env_ver_glk_v1', { heroAngle: 'hack' }, workspaceId),
    ).rejects.toThrow(/Cross-workspace access denied/);
    await expect(
      service.createVersion(
        { environmentId: 'env_glass_loft', sourceVersionId: 'env_ver_glk_v1', changeSummary: 'x' },
        'tester',
        workspaceId,
      ),
    ).rejects.toThrow(/Cross-workspace access denied/);
  });

  it('does not list other-workspace environments', async () => {
    const list = await service.listEnvironments(workspaceId);
    expect(list.some((e) => e.workspaceId === otherWorkspaceId)).toBe(false);
  });
});

describe('rule 5 — archive is soft only', () => {
  it('archives by status change and keeps all data readable', async () => {
    const { environmentId } = await createIsolatedEnvironment();

    const archived = await service.archiveEnvironment(environmentId, workspaceId);
    expect(archived.status).toBe('archived');

    // Everything is preserved and readable.
    const versions = await service.getVersions(environmentId, workspaceId);
    expect(versions.length).toBe(1);
    const spec = await service.getSpec(versions[0].id, workspaceId);
    expect(spec).toBeDefined();

    // Idempotent.
    const again = await service.archiveEnvironment(environmentId, workspaceId);
    expect(again.status).toBe('archived');
  });

  it('offers no delete path on the service', async () => {
    const serviceAny = service as unknown as Record<string, unknown>;
    const deleteLike = Object.keys(serviceAny).filter((key) =>
      /delete|remove|destroy|purge/i.test(key),
    );
    expect(deleteLike).toEqual([]);
  });
});

describe('rule 1 — locked versions cannot enter edit paths or save', () => {
  it('refuses spec saves on locked versions (service boundary)', async () => {
    await expect(
      service.updateSpec(V1_ID, { roomType: 'hacked' }, workspaceId),
    ).rejects.toThrow(/locked and cannot be edited/);
  });

  it('refuses version-draft updates (lock level/summary) on locked versions', async () => {
    await expect(
      service.updateVersionDraft(V1_ID, { lockLevel: 'strict' }, workspaceId),
    ).rejects.toThrow(/locked and cannot be edited/);
  });

  it('refuses reference metadata changes on locked versions', async () => {
    await expect(
      service.addReference(
        V1_ID,
        { storagePath: 'placeholders/x.svg', referenceType: 'wide', caption: 'x' },
        workspaceId,
      ),
    ).rejects.toThrow(/locked and cannot be edited/);
    await expect(
      service.removeReference(V1_ID, 'eref_wbs_wide', workspaceId),
    ).rejects.toThrow(/locked and cannot be edited/);
  });

  it('allows the same operations on the open draft', async () => {
    const version = await service.updateVersionDraft(V2_ID, { lockLevel: 'strict' }, workspaceId);
    expect(version.lockLevel).toBe('strict');
    const added = await service.addReference(
      V2_ID,
      { storagePath: 'placeholders/environments/wbs/extra.svg', referenceType: 'detail', caption: 'Extra' },
      workspaceId,
    );
    expect(added.sortOrder).toBeGreaterThanOrEqual(0);
    await service.removeReference(V2_ID, added.id, workspaceId);
  });
});

describe('rule 6 — environments are never model-specific', () => {
  it('exposes no model identifier on any environment entity', async () => {
    const list = await service.listEnvironments(workspaceId);
    expect(list.length).toBeGreaterThan(0);

    for (const record of list) {
      for (const key of Object.keys(record)) {
        expect(key).not.toMatch(/model/i);
      }
    }

    const versions = await service.getVersions(DEMO_ENV_ID, workspaceId);
    for (const version of versions) {
      for (const key of Object.keys(version)) {
        expect(key).not.toMatch(/model/i);
      }
    }

    const spec = await service.getSpec(V1_ID, workspaceId);
    for (const key of Object.keys(spec)) {
      expect(key).not.toMatch(/model/i);
    }
  });

  it('defines no service API that binds an environment to a model', () => {
    const prototype = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    const modelBindingMethods = prototype.filter((name) => /model/i.test(name));
    expect(modelBindingMethods).toEqual([]);
  });
});
