"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ZohoIntegrationStatus } from "@/components/zoho-integration-status";

type ContactRole = "ONBOARDING_OWNER" | "EXECUTIVE_SPONSOR" | "TECHNICAL_ADMIN";

type PlanContact = {
  automationEnabled: boolean;
  email: string;
  firstName: string | null;
  id: string;
  lastName: string | null;
  role: ContactRole;
  subscriptionStatus: string;
};

type Readiness = {
  readyForDataSync: boolean;
  readyForJourneyEnrollment: boolean;
  reasons: Array<{ code: string; message: string }>;
  status: string;
};

type AutomationDetails = {
  automationEnrollmentState: string;
  automationOrigin: string;
  contacts: PlanContact[];
  kickoffBookedAt: string | null;
  kickoffBookedBy: string | null;
  readiness: Readiness | null;
};

type ContactFormState = {
  automationEnabled: boolean;
  email: string;
  firstName: string;
  id?: string;
  lastName: string;
  role: ContactRole;
};

const ROLE_OPTIONS: Array<{ label: string; value: ContactRole }> = [
  { label: "Onboarding Owner", value: "ONBOARDING_OWNER" },
  { label: "Executive Sponsor", value: "EXECUTIVE_SPONSOR" },
  { label: "Technical Admin", value: "TECHNICAL_ADMIN" }
];

function roleLabel(role: ContactRole) {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

function readinessLabel(status?: string) {
  return (
    {
      AUTOMATION_EXCLUDED: "Automation excluded",
      MANUAL_VERIFICATION_REQUIRED: "Manual verification required",
      MISSING_INFORMATION: "Missing information",
      READY_FOR_DATA_SYNC: "Ready for data sync",
      READY_FOR_JOURNEY_ENROLLMENT: "Ready for journey enrollment",
      TASK_MAPPING_NEEDS_REVIEW: "Task mapping needs review"
    }[status ?? ""] ?? "Readiness unavailable"
  );
}

function contactName(contact: PlanContact) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Name incomplete";
}

function emptyContactForm(): ContactFormState {
  return {
    automationEnabled: false,
    email: "",
    firstName: "",
    lastName: "",
    role: "ONBOARDING_OWNER"
  };
}

export function OnboardingContactsAdmin({
  onChanged,
  planId
}: {
  onChanged?: () => void | Promise<void>;
  planId: string;
}) {
  const [details, setDetails] = useState<AutomationDetails | null>(null);
  const [contactForm, setContactForm] = useState<ContactFormState | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [correctedBookedAt, setCorrectedBookedAt] = useState("");
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetails = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/plans/${encodeURIComponent(planId)}/contacts`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as (AutomationDetails & { error?: string }) | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.error ?? "Could not load onboarding contacts.");
      }
      setDetails(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load onboarding contacts.");
      setDetails(null);
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  async function saveContact() {
    if (!contactForm) return;
    setIsSaving(true);
    setError(null);
    try {
      const url = contactForm.id
        ? `/api/admin/plans/${encodeURIComponent(planId)}/contacts/${encodeURIComponent(contactForm.id)}`
        : `/api/admin/plans/${encodeURIComponent(planId)}/contacts`;
      const response = await fetch(url, {
        method: contactForm.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(contactForm)
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not save the contact.");
      }
      setContactForm(null);
      await loadDetails();
      await onChanged?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the contact.");
    } finally {
      setIsSaving(false);
    }
  }

  async function removeContact(contact: PlanContact) {
    if (!window.confirm(`Remove ${contactName(contact)} from this onboarding plan?`)) return;
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/plans/${encodeURIComponent(planId)}/contacts/${encodeURIComponent(contact.id)}`,
        { method: "DELETE" }
      );
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not remove the contact.");
      }
      await loadDetails();
      await onChanged?.();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove the contact.");
    }
  }

  async function updateKickoff(action: "book" | "cancel" | "correct") {
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/plans/${encodeURIComponent(planId)}/kickoff-booking`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          bookedAt:
            action === "correct" && correctedBookedAt
              ? new Date(correctedBookedAt).toISOString()
              : undefined,
          reason: action === "cancel" || action === "correct" ? cancelReason : undefined
        })
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not update the kickoff booking.");
      }
      setCancelReason("");
      setCorrectedBookedAt("");
      setIsCancelOpen(false);
      await loadDetails();
      await onChanged?.();
    } catch (bookingError) {
      setError(bookingError instanceof Error ? bookingError.message : "Could not update the kickoff booking.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface-secondary px-4 py-4 md:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted">Onboarding Contacts</p>
          <p className="mt-1 text-sm text-secondary">Plan-specific contacts used for future onboarding communications.</p>
        </div>
        <Button className="h-9 shrink-0" onClick={() => setContactForm(emptyContactForm())} variant="outline">
          <Plus className="mr-2 h-4 w-4" />
          Add Contact
        </Button>
      </div>

      {error ? <p className="mt-3 rounded-xl border border-danger-border/60 bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p> : null}
      {isLoading ? <p className="mt-4 text-sm text-secondary">Loading contact details...</p> : null}

      {!isLoading && details ? (
        <>
          <div className="mt-4 grid gap-2">
            {details.contacts.length > 0 ? (
              details.contacts.map((contact) => (
                <div className="flex flex-col gap-3 rounded-xl border border-border bg-input px-3 py-3 sm:flex-row sm:items-center sm:justify-between" key={contact.id}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{contactName(contact)}</p>
                      <Badge status={contact.automationEnabled ? "complete" : "in_progress"}>
                        {roleLabel(contact.role)}
                      </Badge>
                    </div>
                    <p className="mt-1 break-all text-sm text-secondary">{contact.email}</p>
                    <p className="mt-1 text-xs text-muted">
                      {contact.automationEnabled ? "Automation eligible" : "Automation not enabled"} · Subscription {contact.subscriptionStatus.toLowerCase().replaceAll("_", " ")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      aria-label={`Edit ${contactName(contact)}`}
                      className="h-9 px-3"
                      onClick={() =>
                        setContactForm({
                          automationEnabled: contact.automationEnabled,
                          email: contact.email,
                          firstName: contact.firstName ?? "",
                          id: contact.id,
                          lastName: contact.lastName ?? "",
                          role: contact.role
                        })
                      }
                      variant="outline"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      aria-label={`Remove ${contactName(contact)}`}
                      className="h-9 border-danger-border/60 px-3 text-danger hover:bg-danger-surface"
                      onClick={() => void removeContact(contact)}
                      variant="outline"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-xl border border-border bg-input px-3 py-3 text-sm text-secondary">
                Contact details need to be completed before email automation can be enabled.
              </p>
            )}
          </div>

          {!details.readiness?.readyForDataSync ? (
            <p className="mt-3 text-sm text-secondary">
              Contact details need to be completed before email automation can be enabled.
            </p>
          ) : null}

          <div className="mt-4 border-t border-border pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Automation readiness</p>
                <p className="mt-1 text-sm text-secondary">{readinessLabel(details.readiness?.status)}</p>
              </div>
              <Badge status={details.readiness?.readyForJourneyEnrollment ? "complete" : "in_progress"}>
                {details.automationOrigin} · {details.automationEnrollmentState}
              </Badge>
            </div>
            {details.readiness?.reasons.length ? (
              <ul className="mt-3 grid gap-1 text-xs leading-5 text-muted">
                {details.readiness.reasons.slice(0, 4).map((reason) => (
                  <li key={reason.code}>• {reason.message}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <ZohoIntegrationStatus contacts={details.contacts} planId={planId} />

          <div className="mt-4 border-t border-border pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Kickoff booking</p>
                <p className="mt-1 text-sm text-secondary">
                  {details.kickoffBookedAt
                    ? `Confirmed ${new Date(details.kickoffBookedAt).toLocaleString()}`
                    : "Not yet confirmed. Booking is separate from meeting completion."}
                </p>
              </div>
              {details.kickoffBookedAt ? (
                <Button className="h-9" onClick={() => setIsCancelOpen((current) => !current)} variant="outline">
                  Correct / Cancel
                </Button>
              ) : (
                <Button className="h-9" disabled={isSaving} onClick={() => void updateKickoff("book")}>
                  Mark Kickoff Booked
                </Button>
              )}
            </div>
            {isCancelOpen ? (
              <div className="mt-3 grid gap-2 rounded-xl border border-border bg-input p-3">
                <label className="grid gap-2 text-sm text-secondary">
                  <span>Reason for correction or cancellation</span>
                  <input
                    className="rounded-xl border border-border bg-surface px-3 py-2 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    onChange={(event) => setCancelReason(event.target.value)}
                    value={cancelReason}
                  />
                </label>
                <label className="grid gap-2 text-sm text-secondary">
                  <span>Corrected confirmation time</span>
                  <input
                    className="rounded-xl border border-border bg-surface px-3 py-2 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    onChange={(event) => setCorrectedBookedAt(event.target.value)}
                    type="datetime-local"
                    value={correctedBookedAt}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={isSaving || !cancelReason.trim() || !correctedBookedAt}
                    onClick={() => void updateKickoff("correct")}
                    variant="outline"
                  >
                    Correct Confirmation Time
                  </Button>
                  <Button disabled={isSaving || !cancelReason.trim()} onClick={() => void updateKickoff("cancel")} variant="outline">
                    Cancel Booking Confirmation
                  </Button>
                  <Button onClick={() => setIsCancelOpen(false)} variant="secondary">Keep Confirmation</Button>
                </div>
                <p className="text-xs text-muted">Cancellation is audited and does not automatically restart J1 reminders.</p>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {contactForm ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-overlay/80 p-4 md:items-center">
          <div className="my-4 w-full max-w-lg rounded-2xl border border-border bg-surface p-4 shadow-xl md:p-5" role="dialog" aria-modal="true" aria-labelledby="contact-editor-title">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-info">Onboarding contact</p>
                <h4 className="mt-2 text-xl font-semibold text-foreground" id="contact-editor-title">
                  {contactForm.id ? "Edit Contact" : "Add Contact"}
                </h4>
              </div>
              <Button aria-label="Close contact editor" className="h-9 px-2.5" onClick={() => setContactForm(null)} variant="outline">
                <X className="h-4 w-4" />
              </Button>
            </div>
            {error ? (
              <p className="mt-4 rounded-xl border border-danger-border/60 bg-danger-surface px-3 py-2 text-sm text-danger">
                {error}
              </p>
            ) : null}
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm text-secondary">
                <span>First Name</span>
                <input className="rounded-xl border border-border bg-input px-3 py-2.5 text-foreground outline-none" onChange={(event) => setContactForm((current) => current ? { ...current, firstName: event.target.value } : current)} value={contactForm.firstName} />
              </label>
              <label className="grid gap-2 text-sm text-secondary">
                <span>Last Name</span>
                <input className="rounded-xl border border-border bg-input px-3 py-2.5 text-foreground outline-none" onChange={(event) => setContactForm((current) => current ? { ...current, lastName: event.target.value } : current)} value={contactForm.lastName} />
              </label>
              <label className="grid gap-2 text-sm text-secondary sm:col-span-2">
                <span>Email Address</span>
                <input className="rounded-xl border border-border bg-input px-3 py-2.5 text-foreground outline-none" onChange={(event) => setContactForm((current) => current ? { ...current, email: event.target.value } : current)} required type="email" value={contactForm.email} />
              </label>
              <label className="grid gap-2 text-sm text-secondary sm:col-span-2">
                <span>Contact Role</span>
                <select className="rounded-xl border border-border bg-input px-3 py-2.5 text-foreground outline-none" onChange={(event) => setContactForm((current) => current ? { ...current, role: event.target.value as ContactRole } : current)} value={contactForm.role}>
                  {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-border bg-input px-3 py-3 text-sm text-secondary sm:col-span-2">
                <input checked={contactForm.automationEnabled} className="mt-0.5 h-4 w-4" onChange={(event) => setContactForm((current) => current ? { ...current, automationEnabled: event.target.checked } : current)} type="checkbox" />
                <span>Eligible for future automation. This does not enroll or subscribe the contact.</span>
              </label>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button onClick={() => setContactForm(null)} variant="outline">Cancel</Button>
              <Button disabled={isSaving || !contactForm.email.trim()} onClick={() => void saveContact()}>{isSaving ? "Saving..." : "Save Contact"}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
