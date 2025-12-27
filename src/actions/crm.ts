'use server';

import { PrismaClient } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { ActionState, ActionResult } from '@/lib/types';

// const prisma = new PrismaClient();

// ========== LEADS ==========

const LeadSchema = z.object({
  name: z.string().min(1, 'نام الزامی است'),
  company: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('ایمیل نامعتبر است').optional().or(z.literal('')),
  source: z.string().optional(),
  expectedValue: z.number().optional(),
  notes: z.string().optional(),
});

export async function createLead(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = LeadSchema.safeParse({
    name: formData.get('name'),
    company: formData.get('company'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    source: formData.get('source'),
    expectedValue: formData.get('expectedValue') ? Number(formData.get('expectedValue')) : undefined,
    notes: formData.get('notes'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, company, phone, email, source, expectedValue, notes } = validatedFields.data;

  try {
    await prisma.lead.create({
      data: {
        name,
        company,
        phone,
        email: email || null,
        source,
        expectedValue,
        notes,
      },
    });

    revalidatePath('/dashboard/crm/leads');
    return { message: 'سرنخ با موفقیت ثبت شد.', success: true };
  } catch (error) {
    console.error('Error creating lead:', error);
    return { message: 'خطا در ثبت سرنخ.' };
  }
}

export async function getLeads() {
  try {
    const leads = await prisma.lead.findMany({
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
    return leads.map(lead => ({
      ...lead,
      expectedValue: lead.expectedValue ? Number(lead.expectedValue) : undefined,
      customerId: lead.customerId ?? undefined,
      company: lead.company ?? undefined,
      phone: lead.phone ?? undefined,
      email: lead.email ?? undefined,
      source: lead.source ?? undefined,
      notes: lead.notes ?? undefined,
      assignedTo: lead.assignedTo ?? undefined,
    }));
  } catch (error) {
    console.error('Error fetching leads:', error);
    return [];
  }
}

export async function getLeadById(id: string) {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        customer: true,
      }
    });
    if (!lead) return undefined;
    return {
      ...lead,
      expectedValue: lead.expectedValue ? Number(lead.expectedValue) : undefined,
      customerId: lead.customerId ?? undefined,
      company: lead.company ?? undefined,
      phone: lead.phone ?? undefined,
      email: lead.email ?? undefined,
      source: lead.source ?? undefined,
      notes: lead.notes ?? undefined,
      assignedTo: lead.assignedTo ?? undefined,
    };
  } catch (error) {
    console.error('Error fetching lead:', error);
    return undefined;
  }
}

export async function updateLeadStatus(id: string, status: string) {
  try {
    await prisma.lead.update({
      where: { id },
      data: { status },
    });

    revalidatePath('/dashboard/crm/leads');
    return { success: true, message: 'وضعیت سرنخ بروزرسانی شد.' };
  } catch (error) {
    console.error('Error updating lead status:', error);
    return { success: false, message: 'خطا در بروزرسانی وضعیت.' };
  }
}

export async function convertLeadToCustomer(leadId: string) {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
    });

    if (!lead) {
      return { success: false, message: 'سرنخ یافت نشد.' };
    }

    // Create customer from lead
    const customer = await prisma.customer.create({
      data: {
        name: lead.name,
        phone: lead.phone || undefined,
        email: lead.email || undefined,
        notes: lead.notes || undefined,
      },
    });

    // Update lead to link to customer
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        customerId: customer.id,
        status: 'QUALIFIED',
      },
    });

    revalidatePath('/dashboard/crm/leads');
    revalidatePath('/ dashboard/crm/customers');
    return { success: true, message: 'مشتری با موفقیت ایجاد شد.', customerId: customer.id };
  } catch (error) {
    console.error('Error converting lead to customer:', error);
    return { success: false, message: 'خطا در تبدیل سرنخ به مشتری.' };
  }
}

// ========== DEALS ==========

const DealSchema = z.object({
  title: z.string().min(1, 'عنوان الزامی است'),
  customerId: z.string().min(1, 'انتخاب مشتری الزامی است'),
  value: z.number().min(0, 'مبلغ باید مثبت باشد'),
  probability: z.number().min(0).max(100).optional(),
  expectedClose: z.string().optional(),
  notes: z.string().optional(),
});

export async function createDeal(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = DealSchema.safeParse({
    title: formData.get('title'),
    customerId: formData.get('customerId'),
    value: Number(formData.get('value')),
    probability: formData.get('probability') ? Number(formData.get('probability')) : 25,
    expectedClose: formData.get('expectedClose'),
    notes: formData.get('notes'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { title, customerId, value, probability, expectedClose, notes } = validatedFields.data;

  try {
    await prisma.deal.create({
      data: {
        title,
        customerId,
        value,
        probability: probability || 25,
        expectedClose: expectedClose ? new Date(expectedClose) : undefined,
        notes,
      },
    });

    revalidatePath('/dashboard/crm/deals');
    return { message: 'فرصت فروش با موفقیت ثبت شد.', success: true };
  } catch (error) {
    console.error('Error creating deal:', error);
    return { message: 'خطا در ثبت فرصت فروش.' };
  }
}

export async function getDeals() {
  try {
    const deals = await prisma.deal.findMany({
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
    return deals.map(deal => ({
      ...deal,
      value: Number(deal.value),
      expectedClose: deal.expectedClose ?? undefined,
      actualClose: deal.actualClose ?? undefined,
      notes: deal.notes ?? undefined,
      assignedTo: deal.assignedTo ?? undefined,
      lostReason: deal.lostReason ?? undefined,
      customer: deal.customer ? {
        ...deal.customer,
        phone: deal.customer.phone ?? undefined,
      } : undefined,
    }));
  } catch (error) {
    console.error('Error fetching deals:', error);
    return [];
  }
}

export async function getDealById(id: string) {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id },
      include: {
        customer: true,
      }
    });
    if (!deal) return undefined;
    return {
      ...deal,
      value: Number(deal.value),
      expectedClose: deal.expectedClose ?? undefined,
      actualClose: deal.actualClose ?? undefined,
      notes: deal.notes ?? undefined,
      assignedTo: deal.assignedTo ?? undefined,
      lostReason: deal.lostReason ?? undefined,
      customer: deal.customer ? {
        ...deal.customer,
        phone: deal.customer.phone ?? undefined,
        email: deal.customer.email ?? undefined,
        address: deal.customer.address ?? undefined,
        notes: deal.customer.notes ?? undefined,
        wooId: deal.customer.wooId ?? undefined,
        taxId: deal.customer.taxId ?? undefined,
        segment: deal.customer.segment ?? undefined,
      } : undefined,
    };
  } catch (error) {
    console.error('Error fetching deal:', error);
    return undefined;
  }
}

export async function updateDealStage(id: string, stage: string) {
  try {
    const updateData: { stage: string; actualClose?: Date; probability?: number } = { stage };

    // If won or lost, set actual close date
    if (stage === 'WON' || stage === 'LOST') {
      updateData.actualClose = new Date();
    }

    // Update probability based on stage
    const stageProbabilities: Record<string, number> = {
      PROSPECT: 25,
      PROPOSAL: 50,
      NEGOTIATION: 75,
      WON: 100,
      LOST: 0,
    };
    updateData.probability = stageProbabilities[stage] || 25;

    await prisma.deal.update({
      where: { id },
      data: updateData,
    });

    revalidatePath('/dashboard/crm/deals');
    return { success: true, message: 'مرحله فرصت بروزرسانی شد.' };
  } catch (error) {
    console.error('Error updating deal stage:', error);
    return { success: false, message: 'خطا در بروزرسانی مرحله.' };
  }
}

// ========== SUPPORT TICKETS ==========

const TicketSchema = z.object({
  customerId: z.string().min(1, 'انتخاب مشتری الزامی است'),
  subject: z.string().min(1, 'موضوع الزامی است'),
  description: z.string().min(1, 'توضیحات الزامی است'),
  priority: z.string().optional(),
});

export async function createTicket(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = TicketSchema.safeParse({
    customerId: formData.get('customerId'),
    subject: formData.get('subject'),
    description: formData.get('description'),
    priority: formData.get('priority') || 'MEDIUM',
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { customerId, subject, description, priority } = validatedFields.data;

  try {
    await prisma.supportTicket.create({
      data: {
        customerId,
        subject,
        description,
        priority: priority || 'MEDIUM',
      },
    });

    revalidatePath('/dashboard/crm/support');
    return { message: 'تیکت با موفقیت ثبت شد.', success: true };
  } catch (error) {
    console.error('Error creating ticket:', error);
    return { message: 'خطا در ثبت تیکت.' };
  }
}

export async function getTickets() {
  try {
    const tickets = await prisma.supportTicket.findMany({
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    return tickets.map(ticket => ({
      ...ticket,
      assignedTo: ticket.assignedTo ?? undefined,
      resolution: ticket.resolution ?? undefined,
      customer: ticket.customer ? {
        ...ticket.customer,
        phone: ticket.customer.phone ?? undefined,
      } : undefined,
    }));
  } catch (error) {
    console.error('Error fetching tickets:', error);
    return [];
  }
}

export async function getTicketById(id: string) {
  try {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        customer: true,
      }
    });

    if (!ticket) return undefined;

    return {
      ...ticket,
      assignedTo: ticket.assignedTo ?? undefined,
      resolution: ticket.resolution ?? undefined,
      customer: ticket.customer ? {
        ...ticket.customer,
        phone: ticket.customer.phone ?? undefined,
        email: ticket.customer.email ?? undefined,
        address: ticket.customer.address ?? undefined,
        wooId: ticket.customer.wooId ?? undefined,
        notes: ticket.customer.notes ?? undefined,
        creditLimit: Number(ticket.customer.creditLimit),
        segment: ticket.customer.segment ?? undefined,
        taxId: ticket.customer.taxId ?? undefined,
        commissionRate: ticket.customer.commissionRate ? Number(ticket.customer.commissionRate) : undefined,
      } : undefined,
    };
  } catch (error) {
    console.error('Error fetching ticket:', error);
    return undefined;
  }
}

export async function updateTicketStatus(id: string, status: string) {
  try {
    await prisma.supportTicket.update({
      where: { id },
      data: { status },
    });

    revalidatePath('/dashboard/crm/support');
    return { success: true, message: 'وضعیت تیکت بروزرسانی شد.' };
  } catch (error) {
    console.error('Error updating ticket status:', error);
    return { success: false, message: 'خطا در بروزرسانی وضعیت.' };
  }
}

export async function assignTicket(id: string, assignedTo: string) {
  try {
    await prisma.supportTicket.update({
      where: { id },
      data: { assignedTo },
    });

    revalidatePath('/dashboard/crm/support');
    return { success: true, message: 'تیکت واگذار شد.' };
  } catch (error) {
    console.error('Error assigning ticket:', error);
    return { success: false, message: 'خطا در واگذاری تیکت.' };
  }
}

export async function resolveTicket(id: string, resolution: string) {
  try {
    await prisma.supportTicket.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolution,
      },
    });

    revalidatePath('/dashboard/crm/support');
    return { success: true, message: 'تیکت حل شد.' };
  } catch (error) {
    console.error('Error resolving ticket:', error);
    return { success: false, message: 'خطا در حل تیکت.' };
  }
}

export async function getCRMDashboardStats() {
  try {
    const [
      totalCustomers,
      activeDealsCount,
      activeDealsValue,
      openTicketsCount,
      recentLeads,
      recentDeals,
      topCustomers,
      recentActivity
    ] = await Promise.all([
      prisma.customer.count(),
      prisma.deal.count({ where: { stage: { notIn: ['WON', 'LOST'] } } }),
      prisma.deal.aggregate({
        where: { stage: { notIn: ['WON', 'LOST'] } },
        _sum: { value: true }
      }),
      prisma.supportTicket.count({ where: { status: { not: 'CLOSED' } } }),
      prisma.lead.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { customer: true }
      }),
      prisma.deal.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { customer: true }
      }),
      // Top 5 customers by total order value
      prisma.customer.findMany({
        take: 5,
        select: {
          id: true,
          name: true,
          email: true,
          orders: {
            select: {
              totalAmount: true,
            }
          }
        }
      }),
      // Recent 10 activity logs
      prisma.activityLog.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              name: true,
              email: true
            }
          }
        }
      })
    ]);

    // Calculate revenue for top customers and sort
    const customersWithRevenue = topCustomers
      .map(customer => ({
        ...customer,
        totalRevenue: customer.orders.reduce((sum, order) => sum + Number(order.totalAmount), 0)
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 5);

    return {
      totalCustomers,
      activeDealsCount,
      activeDealsValue: Number(activeDealsValue._sum.value || 0),
      openTicketsCount,
      recentLeads,
      recentDeals,
      topCustomers: customersWithRevenue,
      recentActivity
    };
  } catch (error) {
    console.error('Error fetching CRM stats:', error);
    return {
      totalCustomers: 0,
      activeDealsCount: 0,
      activeDealsValue: 0,
      openTicketsCount: 0,
      recentLeads: [],
      recentDeals: [],
      topCustomers: [],
      recentActivity: []
    };
  }
}

