import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Hero } from "@/components/marketing/Hero";
import { TemplatesScroll } from "@/components/marketing/TemplatesScroll";
import { ScrollReveal } from "@/components/marketing/ScrollReveal";

export default async function PreviewPage(props: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const searchParams = await props.searchParams;
  if (searchParams?.key !== "taqreer2025") {
    redirect("/");
  }

  const supabase = await createClient();
  // Verified auth (see comments on layout.tsx + (marketing)/page.tsx).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isLoggedIn = !!user;

  return (
    <main>
      
    
    <nav className="fixed w-full z-50 bg-brand-dark/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-20 relative">
                
                <div className="flex-shrink-0 flex items-center">
                    <a className="flex items-center gap-2" href="#">
                        <Image src="/logo-light.svg" alt="Taqreer Logo" width={140} height={32} className="h-8 w-auto object-contain" />
                    </a>
                </div>
                
                <div className="hidden md:flex items-center gap-8 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                    <a className="text-sm text-gray-300 hover:text-white transition-colors cursor-pointer" href="#">الرئيسية</a>
                    <a className="text-sm text-gray-300 hover:text-white transition-colors cursor-pointer" href="#features">المميزات</a>
                    <a className="text-sm text-gray-300 hover:text-white transition-colors cursor-pointer" href="#pricing">الأسعار</a>
                    <a className="text-sm text-gray-300 hover:text-white transition-colors cursor-pointer" href="#">القوالب</a>
                </div>
                
                <div className="hidden md:flex items-center gap-4">
                    {isLoggedIn ? (
                        <Link
                            href="/dashboard"
                            className="text-sm text-black bg-white hover:bg-gray-100 px-6 py-2 rounded-full font-medium transition-colors"
                        >
                            لوحة التحكم
                        </Link>
                    ) : (
                        <>
                            <Link
                                href="/auth/login"
                                className="text-sm text-gray-300 hover:text-white px-4 py-2 rounded-full border border-white/10 hover:border-white/30 transition-all"
                            >
                                تسجيل الدخول
                            </Link>
                            <Link
                                href="/auth/signup"
                                className="text-sm text-black bg-white hover:bg-gray-100 px-6 py-2 rounded-full font-medium transition-colors"
                            >
                                إنشاء حساب
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </div>
    </nav>
    
    
    <Hero />
    
    
    <section className="py-32">
        <ScrollReveal direction="up">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-4xl md:text-5xl font-bold mb-12">موثوق بنا من قبل</h2>
            <div className="overflow-hidden w-full relative mask-edges" dir="ltr">
                <div className="flex w-max animate-marquee-rtl pause-on-hover opacity-60 grayscale hover:grayscale-0 transition-all duration-500">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className="flex items-center gap-16 px-8">
                            <span className="text-2xl font-bold tracking-widest">TED</span>
                            <span className="text-xl font-bold flex items-center gap-1"><svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 22h20L12 2z"></path></svg>Lattice</span>
                            <span className="text-xl font-bold">NCR</span>
                            <span className="text-xl font-bold">PACIFIC FUNDS</span>
                            <span className="text-xl font-bold">Rakuten</span>
                            <span className="text-xl font-bold">zendesk</span>
                            <span className="text-xl font-bold">DELL</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
        </ScrollReveal>
    </section>
    
    
    <section id="features" className="py-32 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <ScrollReveal direction="up">
            <div className="text-center mb-16">
                <h2 className="text-4xl md:text-5xl font-bold mb-8">كل ما تحتاجه لإنشاء عرض <br /> تقديمي احترافي</h2>
                <p className="text-gray-400 text-lg mb-8">ابدأ من محتوى خام، طوّر عرضًا موجودًا، أو استخدم قالبًا جاهزًا.
                    تقرير <br /> يساعدك في كل مرحلة من مراحل إنشاء العرض.</p>
            </div>
            </ScrollReveal>
            <div className="grid md:grid-cols-2 gap-6">
                
                <ScrollReveal direction="up" delay={0.1}>
                <div className="plan-banner p-8 transition-colors group feature-card-glow">
                    <div
                        className="w-12 h-12 rounded-xl bg-brand-purple-900/50 flex items-center justify-center text-brand-purple-400 mb-6 border border-brand-purple-500/20 group-hover:bg-brand-purple-500 group-hover:text-white transition-colors">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                                strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                        </svg>
                    </div>
                    <h3 className="text-2xl font-bold mb-4">أنشئ عرضًا مصممًا بالكامل <br /> بدون أي Prompt</h3>
                    <p className="text-gray-400 text-sm leading-relaxed">
                        اجمع المحتوى والهوية البصرية معًا، وسيقوم تقرير بإنشاء عرض PowerPoint كامل،
                        بتصميم احترافي، مع مراعاة ألوان العلامة، الخطوط، الشعار، وأسلوب التوجيه البصري.
                    </p>
                </div>
                </ScrollReveal>
                
                <ScrollReveal direction="up" delay={0.2}>
                <div className="plan-banner p-8 transition-colors group feature-card-glow">
                    <div
                        className="w-12 h-12 rounded-xl bg-brand-purple-900/50 flex items-center justify-center text-brand-purple-400 mb-6 border border-brand-purple-500/20 group-hover:bg-brand-purple-500 group-hover:text-white transition-colors">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round"
                                strokeWidth="2"></path>
                        </svg>
                    </div>
                    <h3 className="text-2xl font-bold mb-4">حسّن عرض PowerPoint <br /> موجود مسبقًا</h3>
                    <p className="text-gray-400 text-sm leading-relaxed">
                        ارفع ملف PowerPoint الحالي، وسيقوم تقرير بتحسين التصميم، الألوان، المساحات،
                        التسلسل الهرمي، وتنسيق النصوص، مع الحفاظ على المحتوى الأساسي للعرض.
                    </p>
                </div>
                </ScrollReveal>
            </div>
            
            <ScrollReveal direction="up" delay={0.3}>
            <div
                className="mt-6 plan-banner p-8 flex flex-col md:flex-row items-center gap-12 overflow-hidden relative feature-card-glow transition-colors">
                <div className="w-full md:w-1/2 z-10">
                    <div
                        className="w-12 h-12 rounded-xl bg-brand-purple-900/50 flex items-center justify-center text-brand-purple-400 mb-6 border border-brand-purple-500/20">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                                d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                                strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                        </svg>
                    </div>
                    <h3 className="text-3xl font-bold mb-4">قوالب جاهزة تدعم RTL</h3>
                    <p className="text-gray-400 text-sm leading-relaxed mb-8">
                        ابدأ من قوالب مصممة للعروض العربية والإنجليزية، مع دعم كامل لاتجاه النص من
                        اليمين إلى اليسار، وتنسيق مناسب للعناوين، الفقرات، الجداول، والشرائح ثنائية اللغة.
                    </p>
                    <button
                        className="px-6 py-2 rounded-full bg-button-gradient text-white font-medium hover:opacity-90 transition-opacity cursor-pointer">
                        ابدأ مجانًا
                    </button>
                </div>
                <div className="w-full md:w-1/2 relative flex justify-center mt-8 md:mt-0">
                    <div className="w-full px-2 sm:px-0">
                        <TemplatesScroll />
                    </div>
                </div>
            </div>
            </ScrollReveal>
        </div>
    </section>
    
    
    <section id="pricing" className="py-32 relative glow-effect">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <ScrollReveal direction="up">
            <div className="text-center mb-16">
                <h2 className="text-4xl md:text-5xl font-bold mb-8">خطط بسيطة حسب <br /> احتياجك</h2>
                <p className="text-gray-400 text-lg mb-8">ابدأ مجانًا، أو اختر خطة شهرية تناسب حجم عروضك وعدد الشرائح التي
                    تحتاجها.</p>
            </div>
            </ScrollReveal>
            <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto pt-4">
                
                <ScrollReveal direction="right" delay={0.1} className="flex">
                <div className="plan-banner p-8 flex flex-col w-full feature-card-glow transition-colors">
                    <h3 className="text-2xl font-bold mb-4 text-center">مجاني</h3>
                    <p className="text-gray-400 text-sm text-center mb-8 h-10">للتجربة وإنشاء عروض <br /> بسيطة بسرعة.</p>
                    <div className="space-y-4 mb-8 flex-grow">
                        
                        <div className="flex items-center gap-3 text-sm"><svg className="w-4 h-4 text-brand-purple-500"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                        <div className="flex items-center gap-3 text-sm"><svg className="w-4 h-4 text-brand-purple-500"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                        <div className="flex items-center gap-3 text-sm"><svg className="w-4 h-4 text-brand-purple-500"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                        <div className="flex items-center gap-3 text-sm text-gray-500"><svg className="w-4 h-4 opacity-50"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                        <div className="flex items-center gap-3 text-sm text-gray-500"><svg className="w-4 h-4 opacity-50"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                        <div className="flex items-center gap-3 text-sm text-gray-500"><svg className="w-4 h-4 opacity-50"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                    </div>
                    <div className="text-center mt-auto">
                        <div className="text-4xl font-bold mb-2">$0</div>
                        <div className="text-xs text-gray-400 mb-6">يمكنك الترقية في أي وقت</div>
                        <button
                            className="w-full py-3 rounded-full bg-button-gradient text-white font-medium hover:opacity-90 transition-opacity cursor-pointer">ابدأ
                            مجانًا</button>
                    </div>
                </div>
                </ScrollReveal>
                
                <ScrollReveal direction="up" delay={0.2} className="flex relative pt-3">
                    <div
                        className="absolute! -top-3 left-1/2 z-20 w-fit -translate-x-1/2 whitespace-nowrap bg-brand-purple-500 text-xs px-3 py-1 rounded-full font-bold">
                        الأكثر شعبية</div>
                <div
                    className="plan-banner p-8 flex flex-col relative transform md:-translate-y-4 shadow-[0_0_40px_rgba(168,85,247,0.2)] w-full feature-card-glow transition-colors">
                    <h3 className="text-2xl font-bold mb-4 text-center">احترافي</h3>
                    <p className="text-gray-400 text-sm text-center mb-8 h-10">للمستخدمين الذين ينشئون <br /> عروضًا وتقارير
                        بشكل مستمر.</p>
                    <div className="space-y-4 mb-8 flex-grow">
                        <div className="flex items-center gap-3 text-sm"><svg className="w-4 h-4 text-brand-purple-500"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                        <div className="flex items-center gap-3 text-sm"><svg className="w-4 h-4 text-brand-purple-500"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                        <div className="flex items-center gap-3 text-sm"><svg className="w-4 h-4 text-brand-purple-500"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                        <div className="flex items-center gap-3 text-sm"><svg className="w-4 h-4 text-brand-purple-500"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                        <div className="flex items-center gap-3 text-sm"><svg className="w-4 h-4 text-brand-purple-500"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                        <div className="flex items-center gap-3 text-sm text-gray-500"><svg className="w-4 h-4 opacity-50"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                    </div>
                    <div className="text-center mt-auto">
                        <div className="flex justify-center items-end gap-1 mb-2">
                            <span className="text-4xl font-bold">$196</span>
                            <span className="text-gray-400 mb-1">/ شهرياً</span>
                        </div>
                        <div className="text-xs text-gray-400 mb-6">يمكنك ترقية أو تخفيض خطتك في أي وقت</div>
                        <button
                            className="w-full py-3 rounded-full bg-white text-brand-dark font-bold hover:bg-gray-100 transition-colors cursor-pointer">ابدأ
                            مجانًا</button>
                    </div>
                </div>
                </ScrollReveal>
                
                <ScrollReveal direction="left" delay={0.3} className="flex">
                <div className="plan-banner p-8 flex flex-col w-full feature-card-glow transition-colors">
                    <h3 className="text-2xl font-bold mb-4 text-center">شركة</h3>
                    <p className="text-gray-400 text-sm text-center mb-8 h-10">للفرق والشركات التي تحتاج إلى تعاون، <br />
                        هوية موحدة، ومشاريع أكبر.</p>
                    <div className="space-y-4 mb-8 flex-grow">
                        <div className="flex items-center gap-3 text-sm"><svg className="w-4 h-4 text-brand-purple-500"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                        <div className="flex items-center gap-3 text-sm"><svg className="w-4 h-4 text-brand-purple-500"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                        <div className="flex items-center gap-3 text-sm"><svg className="w-4 h-4 text-brand-purple-500"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                        <div className="flex items-center gap-3 text-sm"><svg className="w-4 h-4 text-brand-purple-500"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                        <div className="flex items-center gap-3 text-sm"><svg className="w-4 h-4 text-brand-purple-500"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                        <div className="flex items-center gap-3 text-sm"><svg className="w-4 h-4 text-brand-purple-500"
                                fill="currentColor" viewBox="0 0 20 20">
                                <path clipRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    fillRule="evenodd"></path>
                            </svg> إنشاء عروض بالذكاء الاصطناعي</div>
                    </div>
                    <div className="text-center mt-auto">
                        <div className="flex justify-center items-end gap-1 mb-2">
                            <span className="text-4xl font-bold">$196</span>
                            <span className="text-gray-400 mb-1">/ شهرياً</span>
                        </div>
                        <div className="text-xs text-gray-400 mb-6">يمكنك تخصيص خطتك في أي وقت</div>
                        <button
                            className="w-full py-3 rounded-full bg-button-gradient text-white font-medium hover:opacity-90 transition-opacity cursor-pointer">ابدأ
                            مجانًا</button>
                    </div>
                </div>
                </ScrollReveal>
            </div>
        </div>
    </section>
    
    
    <footer className="border-t border-white/10 pt-20 pb-8 bg-black/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
                
                <div>
                    <h4 className="text-white font-bold mb-6">تواصل</h4>
                    <ul className="space-y-3 text-sm text-gray-400">
                        <li><a className="hover:text-white transition-colors" href="#">البريد الإلكتروني</a></li>
                        <li><a className="hover:text-white transition-colors" href="#">الدعم الفني</a></li>
                        <li><a className="hover:text-white transition-colors" href="#">نموذج التواصل</a></li>
                    </ul>
                </div>
                
                <div>
                    <h4 className="text-white font-bold mb-6">روابط</h4>
                    <ul className="space-y-3 text-sm text-gray-400">
                        <li><a className="hover:text-white transition-colors" href="#">المميزات</a></li>
                        <li><a className="hover:text-white transition-colors" href="#">الأسعار</a></li>
                        <li><a className="hover:text-white transition-colors" href="#">الأسئلة الشائعة</a></li>
                    </ul>
                </div>
                
                <div>
                    <h4 className="text-white font-bold mb-6">التواصل الاجتماعي</h4>
                    <ul className="space-y-3 text-sm text-gray-400">
                        <li><a className="hover:text-white transition-colors" href="#">Twitter</a></li>
                        <li><a className="hover:text-white transition-colors" href="#">LinkedIn</a></li>
                        <li><a className="hover:text-white transition-colors" href="#">Instagram</a></li>
                    </ul>
                </div>
                
                <div>
                    <h4 className="text-white font-bold mb-6">قانوني</h4>
                    <ul className="space-y-3 text-sm text-gray-400">
                        <li><a className="hover:text-white transition-colors" href="#">سياسة الخصوصية</a></li>
                        <li><a className="hover:text-white transition-colors" href="#">الشروط والأحكام</a></li>
                    </ul>
                </div>
            </div>
            <div
                className="flex flex-col md:flex-row justify-between items-center pt-8 border-t border-white/10 text-sm text-gray-500">
                <div className="flex items-center gap-2 mb-4 md:mb-0">
                    <Image src="/logo-light.svg" alt="Taqreer Logo" width={120} height={28} className="h-7 w-auto object-contain opacity-80" />
                </div>
                <p>© 2024 taqreer.ai جميع الحقوق محفوظة.</p>
            </div>
        </div>
    </footer>
    

    </main>
  );
}
