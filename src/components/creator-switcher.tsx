"use client";

import { useFormStatus } from "react-dom";
import { switchCreatorAction } from "@/app/actions";

type CreatorOption = { id: string; name: string; status: string };

function SwitchStatus() {
  const { pending } = useFormStatus();
  return <span className="creator-switch-status" aria-live="polite">{pending ? "Switching…" : ""}</span>;
}

export function CreatorSwitcher({ activeCreatorId, creators }: { activeCreatorId: string; creators: CreatorOption[] }) {
  return (
    <form action={switchCreatorAction} className="creator-switch-form">
      <label htmlFor="creator-workspace">Creator workspace</label>
      <select
        id="creator-workspace"
        name="creatorId"
        defaultValue={activeCreatorId}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {creators.map((creator) => <option value={creator.id} key={creator.id}>{creator.name}{creator.status === "setup" ? " · setup" : ""}</option>)}
      </select>
      <SwitchStatus />
    </form>
  );
}
