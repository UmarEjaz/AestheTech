"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createSalon } from "@/lib/actions/salon";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function CreateSalonForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [plan, setPlan] = useState("");

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugManuallyEdited) {
      setSlug(slugify(value));
    }
  };

  const handleSlugChange = (value: string) => {
    setSlugManuallyEdited(true);
    setSlug(slugify(value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Salon name is required");
      return;
    }
    if (!slug.trim()) {
      setError("Slug is required");
      return;
    }

    setSubmitting(true);
    try {
      const result = await createSalon({
        name: name.trim(),
        slug: slug.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        subscriptionPlan: plan || undefined,
      });

      if (result.success) {
        router.push(`/admin/salons/${result.data.id}`);
      } else {
        setError(result.error);
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="name">
          Salon Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="name"
          placeholder="e.g. Glow Beauty Studio"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          disabled={submitting}
          required
        />
      </div>

      {/* Slug */}
      <div className="space-y-2">
        <Label htmlFor="slug">
          Slug <span className="text-destructive">*</span>
        </Label>
        <Input
          id="slug"
          placeholder="e.g. glow-beauty-studio"
          value={slug}
          onChange={(e) => handleSlugChange(e.target.value)}
          disabled={submitting}
          className="font-mono text-sm"
          required
        />
        <p className="text-xs text-muted-foreground">
          URL-friendly identifier. Auto-generated from the name.
        </p>
      </div>

      {/* Email */}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="contact@salon.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
        />
      </div>

      {/* Phone */}
      <div className="space-y-2">
        <Label htmlFor="phone">Phone</Label>
        <Input
          id="phone"
          type="tel"
          placeholder="+1 (555) 000-0000"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={submitting}
        />
      </div>

      {/* Address */}
      <div className="space-y-2">
        <Label htmlFor="address">Address</Label>
        <Textarea
          id="address"
          placeholder="123 Main Street, City, State"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          disabled={submitting}
          rows={2}
        />
      </div>

      {/* Subscription Plan */}
      <div className="space-y-2">
        <Label htmlFor="plan">Subscription Plan</Label>
        <Select value={plan} onValueChange={setPlan} disabled={submitting}>
          <SelectTrigger id="plan">
            <SelectValue placeholder="Select a plan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BASIC">Basic</SelectItem>
            <SelectItem value="PRO">Pro</SelectItem>
            <SelectItem value="ENTERPRISE">Enterprise</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          New salons start on a trial. You can assign a plan now or later.
        </p>
      </div>

      {/* Submit */}
      <div className="flex justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Create Salon
        </Button>
      </div>
    </form>
  );
}
