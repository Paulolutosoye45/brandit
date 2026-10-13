'use client';
import { ErrorBody } from '@/components/ErrorBody';
export default function Error(p: { error: Error & { digest?: string }; reset: () => void }) { return <ErrorBody {...p} standalone />; }
