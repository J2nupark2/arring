import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-24">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle>이메일을 확인해주세요</CardTitle>
          <CardDescription>
            {email ? <>{email}로</> : "가입하신 이메일로"} 인증 메일을
            보냈습니다. 메일함에서 링크를 클릭하면 가입이 완료됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
}
