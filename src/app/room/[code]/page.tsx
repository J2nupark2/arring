import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return (
    <div className="mx-auto flex max-w-lg flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>통화방 {code}</CardTitle>
          <CardDescription>
            WebRTC 음성 연결은 Phase 1에서 구현됩니다. 이 페이지는 방 코드
            라우팅 뼈대입니다.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
}
