import { redirect } from "next/navigation";

export default async function InternalPage() {
  redirect("/admin");
}
