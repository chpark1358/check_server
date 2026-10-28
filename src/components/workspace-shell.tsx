"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Server, CalendarDays, ClipboardCheck, Layers, Mail, History, FolderOpen, Settings2, Users, ChevronRight, Menu, LogOut, PanelLeftClose } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export type WorkspaceTab = "schedule" | "check" | "batch" | "mail" | "history" | "documents" | "settings" | "admin";
const pages = [
  {id:"schedule",label:"점검 일정",group:"업무",icon:CalendarDays,description:"영업 예정 시기를 참고해 준비할 점검을 확인하세요. 원본 시트는 읽기 전용입니다."},
  {id:"check",label:"점검 데이터",group:"업무",icon:ClipboardCheck,description:"수집 결과를 검토하고 확인서를 준비하세요."},
  {id:"batch",label:"일괄 점검",group:"업무",icon:Layers,description:"여러 고객의 점검부터 발송까지, 단계별로 확인하세요."},
  {id:"mail",label:"메일 발송",group:"업무",icon:Mail,description:"받는 사람과 확인서를 확인하고 메일을 작성하세요."},
  {id:"history",label:"작업 이력",group:"기록",icon:History,description:"점검·문서·메일 처리 결과를 한곳에서 찾아보세요."},
  {id:"documents",label:"문서함",group:"기록",icon:FolderOpen,description:"생성한 확인서와 파일의 사용 기한을 확인하세요."},
  {id:"settings",label:"개인 설정",group:"설정",icon:Settings2,description:"내 문서와 메일 작업에 적용할 기본값을 관리하세요."},
  {id:"admin",label:"관리자",group:"설정",icon:Users,description:"팀의 작업 기록과 사용자 연결을 관리하세요."},
] as const;

export function WorkspaceShell({tab,onTabChange,children,email,role,preview,realSend,busy,onSignOut,counts={}}:{
  tab:WorkspaceTab;onTabChange:(tab:WorkspaceTab)=>void;children:ReactNode;email:string;role:string|null;
  preview:boolean;realSend:boolean;busy:string|null;onSignOut:()=>void;counts?:Partial<Record<WorkspaceTab,number>>;
}) {
  const [menuOpen,setMenuOpen]=useState(false);
  useEffect(()=>{window.scrollTo({top:0,behavior:"auto"});},[tab]);
  const page=pages.find(item=>item.id===tab)!;
  const available=pages.filter(item=>item.id!=="admin"||role==="admin");
  const select=(next:WorkspaceTab)=>{onTabChange(next);setMenuOpen(false);};
  const navigation=()=>available.map((item,index)=>{
    const Icon=item.icon;
    const contents=<><Icon aria-hidden className="size-[19px]"/><span>{item.label}</span>{Boolean(counts[item.id])&&<span className="nav-count">{counts[item.id]}</span>}</>;
    return <div key={item.id} className="nav-item">
      {(index===0||available[index-1].group!==item.group)&&<p className="nav-group">{item.group}</p>}
      <button type="button" className="workspace-nav-button" data-active={item.id===tab||undefined} aria-current={item.id===tab?"page":undefined} onClick={()=>select(item.id)}>{contents}</button>
    </div>;
  });
  return <div className="workspace-shell">
    <a href="#workspace-content" className="workspace-skip">본문으로 이동</a>
    <aside className="workspace-sidebar" aria-label="주요 메뉴">
      <div className="workspace-brand"><Server aria-hidden/><span>Check Server</span></div>
      <nav className="workspace-navigation" aria-label="작업 화면">{navigation()}</nav>
      <div className="workspace-sidebar-footer"><span className="connection-dot"/>{preview?"가상 데이터 프리뷰":"점검 워크스페이스"}<p>업무 · 기록 · 연결</p></div>
    </aside>
    <div className="workspace-main">
      <header className="workspace-topbar">
        <Button className="workspace-menu" variant="ghost" size="icon" aria-label="메뉴 열기" onClick={()=>setMenuOpen(true)}><Menu/></Button>
        <div className="workspace-breadcrumb"><span>{page.group}</span><ChevronRight aria-hidden/><strong>{page.label}</strong></div>
        <div className="workspace-account"><span className="environment-label">{preview?"프리뷰":realSend?"운영 · 실발송 가능":"테스트 전송"}</span><ThemeToggle/><span className="account-avatar" aria-hidden>{email.slice(0,1).toUpperCase()}</span><span className="account-email" title={email}>{email}</span><Button variant="ghost" size="icon" aria-label="로그아웃" onClick={onSignOut}><LogOut/></Button></div>
      </header>
      <div id="workspace-content" className="workspace-content" tabIndex={-1}>
        {preview&&<div className="workspace-preview-note"><span>샘플 고객으로 화면을 확인하는 프리뷰입니다. 실제 발송·초대는 실행되지 않습니다.</span><Link href="/">실제 계정 로그인<ChevronRight aria-hidden/></Link></div>}
        <div className="workspace-pagehead"><div><h1>{page.label}</h1><p>{page.description}</p></div>{busy&&<span role="status" className="workspace-busy"><span className="busy-dot"/>{busy}</span>}</div>
        {children}
      </div>
    </div>
    <Dialog open={menuOpen} onOpenChange={setMenuOpen}><DialogContent className="workspace-mobile-menu translate-x-0 translate-y-0" showCloseButton={false}>
      <div className="flex items-center justify-between"><DialogTitle className="workspace-brand"><Server aria-hidden/>Check Server</DialogTitle><Button variant="ghost" size="icon" aria-label="메뉴 닫기" onClick={()=>setMenuOpen(false)}><PanelLeftClose/></Button></div>
      <DialogDescription className="sr-only">업무 화면을 선택하세요.</DialogDescription><nav aria-label="모바일 주요 메뉴">{navigation()}</nav>
    </DialogContent></Dialog>
  </div>;
}

export function WorkspacePanel({value,activeValue,keepMounted=false,children}:{value:WorkspaceTab;activeValue:WorkspaceTab;keepMounted?:boolean;children:ReactNode}) {
  if(value!==activeValue&&!keepMounted)return null;
  return <div data-slot="workspace-panel" hidden={value!==activeValue}>{children}</div>;
}
