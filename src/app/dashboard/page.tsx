import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">대시보드</h1>
        <Button disabled>통화방 만들기 (준비 중)</Button>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>내 통화방</CardTitle>
            <CardDescription>
              생성/참여 중인 통화방 목록은 Phase 1에서 연결됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>친구 목록</CardTitle>
            <CardDescription>
              친구 요청/수락 기능은 Phase 2에서 연결됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    </div>
  );
}
