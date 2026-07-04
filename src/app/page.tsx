import { GuestEntryCard } from "@/components/guest-entry-card";
import { RedirectIfAuthed } from "@/components/redirect-if-authed";

export default function Home() {
  return (
    <>
      <RedirectIfAuthed to="/party" />
      <GuestEntryCard />
    </>
  );
}
