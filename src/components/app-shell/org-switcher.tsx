"use client";

import type { ChangeEvent } from "react";
import { setActiveOrgAction } from "@/app/app/actions";
import type { MembershipWithOrg } from "@/server/active-org";

export function OrgSwitcher({
  memberships,
  activeOrgId,
}: {
  memberships: MembershipWithOrg[];
  activeOrgId: string;
}) {
  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form action={setActiveOrgAction}>
      <select
        name="orgId"
        defaultValue={activeOrgId}
        onChange={handleChange}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        aria-label="Organización activa"
      >
        {memberships.map((membership) => (
          <option key={membership.orgId} value={membership.orgId}>
            {membership.orgName}
          </option>
        ))}
      </select>
    </form>
  );
}
