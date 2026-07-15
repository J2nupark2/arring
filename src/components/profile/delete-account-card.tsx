"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function deleteAccount() {
    setDeleting(true);
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmation }),
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error ?? "계정 삭제에 실패했습니다.");
        return;
      }

      window.location.assign("/?accountDeleted=1");
    } catch {
      toast.error("계정 삭제 요청에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-base">계정 관리</CardTitle>
        <CardDescription>
          탈퇴하면 친구, 매칭, 평가 기록과 연동 캐릭터 정보가 삭제되며 되돌릴 수 없습니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive"><Trash2 />회원 탈퇴</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>계정을 삭제할까요?</DialogTitle>
              <DialogDescription>
                본인 확인을 위해 현재 비밀번호와 확인 문구를 입력해주세요.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-1">
              <div className="grid gap-2">
                <Label htmlFor="delete-password">현재 비밀번호</Label>
                <Input id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="delete-confirmation">확인 문구: 회원 탈퇴</Label>
                <Input id="delete-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="회원 탈퇴" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={deleting}>취소</Button>
              <Button variant="destructive" onClick={deleteAccount} disabled={deleting || !password || confirmation !== "회원 탈퇴"}>
                {deleting && <Loader2 className="animate-spin" />}
                영구 삭제
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
