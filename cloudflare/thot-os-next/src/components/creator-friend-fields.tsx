import type { AttachedFriend, CreatorFriend } from "@/lib/library";

export function CreatorFriendFields({ friends, attached }: { friends: CreatorFriend[]; attached: AttachedFriend[] }) {
  const selected = new Set(attached.map((friend) => friend.id));
  const existingEvidence = attached.find((friend) => friend.evidence_platform)?.evidence_platform;
  return <div className="friend-fields"><input type="hidden" name="peopleMode" value="replace" /><fieldset><legend>People in this asset</legend>{friends.length ? friends.map((friend) => <label key={friend.id}><input type="checkbox" name="personId" value={friend.id} defaultChecked={selected.has(friend.id)} /> {friend.stage_name || friend.display_name}</label>) : <p>No creator friends have been added yet.</p>}</fieldset>
    <div className="consent-box"><strong>Paid-platform consent</strong><p>Confirm that the creator friend&apos;s handle is available or their signed release is held in OnlyFans or Fansly.</p><label><input type="checkbox" name="paidConsentConfirmed" defaultChecked={Boolean(existingEvidence)} /> I confirm the paid-use consent requirement is satisfied</label><select name="paidEvidence" defaultValue={existingEvidence || ""}><option value="">Where is the release held?</option><option value="onlyfans">OnlyFans</option><option value="fansly">Fansly</option></select></div>
  </div>;
}
