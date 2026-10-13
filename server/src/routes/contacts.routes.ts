import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { stringify } from 'csv-stringify/sync';
import { SuppressionService } from '../services/suppression.service.js';

export function createContactsRouter(prisma: PrismaClient): Router {
  const router = Router();
  const suppressionService = new SuppressionService(prisma);

  /**
   * List contacts with search, filters, sorting, and pagination
   */
  router.get('/', async (req, res, next) => {
    try {
      const {
        search,
        company,
        role,
        source,
        emailStatus,
        outreachState,
        page = '1',
        limit = '25',
        sortBy = 'createdAt',
        sortOrder = 'desc',
      } = req.query as Record<string, string>;

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};

      if (search) {
        where.OR = [
          { fullName: { contains: search } },
          { email: { contains: search } },
          { companyName: { contains: search } },
          { jobTitle: { contains: search } },
        ];
      }

      if (company) where.companyName = { contains: company };
      if (role) where.matchedRole = { contains: role };
      if (source) where.primarySource = source;
      if (emailStatus) where.emailStatus = emailStatus;
      if (outreachState) where.outreachState = outreachState;

      const [total, contacts] = await Promise.all([
        prisma.contact.count({ where }),
        prisma.contact.findMany({
          where,
          skip,
          take: limitNum,
          orderBy: { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' },
          include: {
            sources: { take: 3 },
            verifications: { take: 1, orderBy: { verifiedAt: 'desc' } },
          },
        }),
      ]);

      res.json({
        data: contacts,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Get single contact with full provenance and sources
   */
  router.get('/:id', async (req, res, next) => {
    try {
      const contact = await prisma.contact.findUnique({
        where: { id: req.params.id },
        include: {
          sources: true,
          verifications: true,
          campaignRecipients: {
            include: { campaign: true },
          },
        },
      });

      if (!contact) {
        return res.status(404).json({ error: 'Contact not found' });
      }

      res.json(contact);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Export contacts to CSV
   */
  router.post('/export', async (req, res, next) => {
    try {
      const { contactIds } = req.body;
      const where = Array.isArray(contactIds) && contactIds.length > 0 ? { id: { in: contactIds } } : {};

      const contacts = await prisma.contact.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      const records = contacts.map((c) => ({
        Email: c.email,
        FirstName: c.firstName || '',
        LastName: c.lastName || '',
        FullName: c.fullName,
        Company: c.companyName,
        Domain: c.companyDomain || '',
        JobTitle: c.jobTitle || '',
        MatchedRole: c.matchedRole || '',
        EmailStatus: c.emailStatus,
        PrimarySource: c.primarySource,
        OutreachState: c.outreachState,
        DiscoveryDate: c.createdAt.toISOString(),
      }));

      const csvData = stringify(records, { header: true });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="contacts-export.csv"');
      res.send(csvData);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Mark contact as suppressed (opted-out or bounced)
   */
  router.post('/suppress', async (req, res, next) => {
    try {
      const { email, reason, notes } = req.body;
      if (!email || !reason) {
        return res.status(400).json({ error: 'Email and reason are required' });
      }

      await suppressionService.suppressEmail(email, reason, notes);
      res.json({ success: true, message: `Address ${email} added to suppression list.` });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
