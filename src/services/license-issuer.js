import { createId } from '../utils/crypto.js';
import { issueLicense } from '../utils/license-jws.js';

const LICENSE_TIMES_SQL = `
  SELECT
    l.id,
    l.school_id AS "schoolId",
    l.license_type AS "licenseType",
    l.status,
    l.offline_days AS "offlineDays",
    sc.status AS "schoolStatus",
    ((l.paid_through_date + 1)::timestamp
      AT TIME ZONE sc.billing_timezone) AS "paidThrough",
    ((l.paid_through_date + l.grace_days::integer + 1)::timestamp
      AT TIME ZONE sc.billing_timezone) AS "graceUntil"
  FROM licenses l
  JOIN schools sc ON sc.id = l.school_id
  WHERE l.id = $1
`;

export async function selectLicenseForIssue(queryable, licenseId) {
  const result = await queryable.query(LICENSE_TIMES_SQL, [
    licenseId,
  ]);
  return result.rows[0] ?? null;
}

export async function issueAndRecordLicense({
  client,
  config,
  privateKey,
  license,
  installation,
  challengeNonce,
  now,
}) {
  const licenseInstallation = {
    ...installation,
    licenseRevision:
      installation.licenseRevision ?? installation.license_revision,
    publicKeyThumbprint:
      installation.publicKeyThumbprint ??
      installation.public_key_thumbprint,
  };
  const issued = issueLicense({
    config,
    privateKey,
    license,
    installation: licenseInstallation,
    challengeNonce,
    now,
  });

  await client.query(
    `INSERT INTO license_issuances
      (jti, license_id, installation_id, license_type, key_id, revision,
       status, issued_at, offline_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      issued.claims.jti,
      license.id,
      installation.id,
      issued.claims.licenseType,
      issued.keyId,
      issued.claims.revision,
      issued.claims.status,
      new Date(issued.claims.iat * 1000),
      issued.claims.offlineUntil ?? null,
    ],
  );

  return issued;
}

export async function recordLicenseEvent(
  client,
  { schoolId, licenseId, installationId, actorAdminId, eventType, details },
) {
  await client.query(
    `INSERT INTO license_events
      (id, school_id, license_id, installation_id, actor_admin_id,
       event_type, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      createId(),
      schoolId ?? null,
      licenseId ?? null,
      installationId ?? null,
      actorAdminId ?? null,
      eventType,
      JSON.stringify(details ?? {}),
    ],
  );
}
