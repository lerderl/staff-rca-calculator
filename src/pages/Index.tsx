import { useNavigate } from "react-router-dom";
import { Database, CalendarCheck, FileSpreadsheet, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { AttributionFooter } from "@/components/attribution-footer.tsx";

export default function Index() {
  const navigate = useNavigate();
  return (
    <div className="min-h-full flex flex-col items-center justify-center px-6 py-16">
      <div className="max-w-2xl w-full text-center space-y-4 mb-12">
        <div className="font-semibold uppercase tracking-widest text-muted-foreground text-lg">NN A & B</div>
        <h1 className="text-3xl font-bold tracking-tight text-balance">Payment Processing System</h1>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Process RCA and other monthly payments using the master personnel database. Upload branch files, match Svc Nos, and generate bank schedules.
        </p>
        <Button onClick={() => navigate("/database")} className="mt-2 cursor-pointer">
          Get Started <ArrowRight size={16} />
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
        <StepCard
          step="1"
          icon={<Database size={20} />}
          title="Master Database"
          desc="Upload or manage the personnel database with bank account details."
          onClick={() => navigate("/database")} />

        <StepCard
          step="2"
          icon={<CalendarCheck size={20} />}
          title="Monthly Processing"
          desc="Select payment type and month, upload branch files, and match Svc Nos automatically."
          onClick={() => navigate("/processing")} />

        <StepCard
          step="3"
          icon={<FileSpreadsheet size={20} />}
          title="Bank Schedules"
          desc="Generate and export payment schedules grouped by bank."
          onClick={() => navigate("/schedules")} />

      </div>

      <div className="w-full max-w-2xl">
        <AttributionFooter />
      </div>
    </div>);

}

function StepCard({
  step, icon, title, desc, onClick






}: {step: string;icon: React.ReactNode;title: string;desc: string;onClick: () => void;}) {
  return (
    <button
      onClick={onClick}
      className="text-left bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer group">
      
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold text-primary/60 bg-primary/10 rounded-full w-6 h-6 flex items-center justify-center">{step}</span>
        <span className="text-primary">{icon}</span>
      </div>
      <div className="font-semibold text-sm mb-1">{title}</div>
      <div className="text-xs text-muted-foreground leading-relaxed">{desc}</div>
    </button>);

}