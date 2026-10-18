import { PrismaClient } from '@prisma/client';
import {
  CompanyTargetInput,
  DiscoveryRunConfig,
  ProviderName,
  DiscoveredPersonProfile,
  EmailVerificationStatus,
} from '../../models/types.js';
import { IContactProvider } from '../../providers/base.provider.js';
import { ApolloProvider } from '../../providers/apollo/apollo.provider.js';
import { HunterProvider } from '../../providers/hunter/hunter.provider.js';
import { SnovProvider } from '../../providers/snov/snov.provider.js';
import { TombaProvider } from '../../providers/tomba/tomba.provider.js';
import { MockProvider } from '../../providers/mock/mock.provider.js';
import { OfficialWebProvider } from '../../providers/official-web/official-web.provider.js';
import { NormalizerService } from '../normalizer.service.js';
import { BudgetService } from '../provider-budget/budget.service.js';
import { EmailVerificationService } from '../email-verification/verifier.service.js';
import { CredentialResolver } from '../../config/credential-resolver.js';
import { logger } from '../../utils/logger.js';

export class DiscoveryOrchestrator {
  private providers: Map<ProviderName, IContactProvider> = new Map();
  private budgetService: BudgetService;
  private verificationService: EmailVerificationService;
  private credentialResolver: CredentialResolver;
  private cancelledRuns: Set<string> = new Set();
  private hasCustomProviders: boolean = false;

  constructor(
    private prisma: PrismaClient,
    customProviders?: Map<ProviderName, IContactProvider>
  ) {
    this.budgetService = new BudgetService(this.prisma);
    this.credentialResolver = new CredentialResolver(this.prisma);
    const hunter = new HunterProvider();
    this.verificationService = new EmailVerificationService(hunter);

    if (customProviders) {
      this.providers = customProviders;
      this.hasCustomProviders = true;
    } else {
      this.providers.set('tomba', new TombaProvider());
      this.providers.set('apollo', new ApolloProvider());
      this.providers.set('hunter', hunter);
      this.providers.set('snov', new SnovProvider());
      this.providers.set('mock', new MockProvider());
      this.providers.set('official_website', new OfficialWebProvider());
    }
  }

  cancelRun(runId: string) {
    this.cancelledRuns.add(runId);
  }

  /**
   * Initializes and executes a full persistent discovery run
   */
  async startDiscovery(
    companies: CompanyTargetInput[],
    config: DiscoveryRunConfig
  ): Promise<string> {
    // 1. Create persistent DiscoveryRun record
    const run = await this.prisma.discoveryRun.create({
      data: {
        status: 'running',
        totalCompanies: companies.length,
        processedCompanies: 0,
        contactsFound: 0,
        creditsConsumed: 0.0,
        maxBudget: config.maxBudget,
        allowEnrichment: config.allowEnrichment,
        freeFirstMode: config.freeFirstMode,
        verifyEmails: config.verifyEmails,
        startedAt: new Date(),
      },
    });

    // 2. Create DiscoveryRunItems for each company
    for (const target of companies) {
      const normalizedDomain = NormalizerService.normalizeDomain(target.domain);
      const cleanName = NormalizerService.normalizeCompanyName(target.name);

      // Upsert company
      const companyRecord = await this.prisma.company.upsert({
        where: normalizedDomain ? { domain: normalizedDomain } : { id: 'placeholder-company-id' },
        update: {
          name: cleanName,
          location: target.location || undefined,
          jobUrl: target.jobUrl || undefined,
          notes: target.notes || undefined,
        },
        create: {
          name: cleanName,
          domain: normalizedDomain,
          normalizedDomain,
          location: target.location,
          jobUrl: target.jobUrl,
          notes: target.notes,
        },
      });

      await this.prisma.discoveryRunItem.create({
        data: {
          discoveryRunId: run.id,
          companyId: companyRecord.id,
          companyName: cleanName,
          companyDomain: normalizedDomain,
          targetRolesJson: JSON.stringify(target.targetRoles),
          status: 'waiting',
          providersTriedJson: JSON.stringify([]),
        },
      });
    }

    // 3. Kick off async execution (background worker loop)
    this.executeRun(run.id, config).catch((err) => {
      logger.error(`Discovery run ${run.id} failed uncaught`, err);
    });

    return run.id;
  }

  /**
   * Main asynchronous execution loop with bounded concurrency & waterfall fallback
   */
  private async executeRun(runId: string, config: DiscoveryRunConfig): Promise<void> {
    const run = await this.prisma.discoveryRun.findUnique({
      where: { id: runId },
      include: { items: { include: { company: true } } },
    });

    if (!run) return;

    // 1. Dynamically resolve credentials for all providers
    const providerStatusMap = new Map<ProviderName, boolean>();
    const allProviders: ProviderName[] = ['tomba', 'apollo', 'hunter', 'snov', 'official_website', 'mock'];

    for (const p of allProviders) {
      const res = await this.credentialResolver.resolve(p);
      const isConfigured = res.isConfigured || (this.hasCustomProviders && this.providers.has(p));
      providerStatusMap.set(p, isConfigured);

      const providerInstance = this.providers.get(p);
      if (providerInstance) {
        if (p === 'tomba' && 'setCredentials' in providerInstance) {
          (providerInstance as TombaProvider).setCredentials(res.apiKey, res.secret || '');
        } else if (p === 'apollo' && 'setApiKey' in providerInstance) {
          (providerInstance as ApolloProvider).setApiKey(res.apiKey);
        } else if (p === 'hunter' && 'setApiKey' in providerInstance) {
          (providerInstance as HunterProvider).setApiKey(res.apiKey);
        } else if (p === 'snov' && 'setCredentials' in providerInstance) {
          (providerInstance as SnovProvider).setCredentials(res.apiKey, res.secret || '');
        }
      }
    }

    const defaultPriority: ProviderName[] = ['tomba', 'apollo', 'hunter', 'snov', 'official_website'];
    const providerPriority: ProviderName[] =
      config.providerPriority && config.providerPriority.length > 0
        ? config.providerPriority
        : defaultPriority;
    const configuredPriority = providerPriority.filter((p) => providerStatusMap.get(p) === true);

    // If none of the selected providers have credentials configured
    if (configuredPriority.length === 0) {
      for (const item of run.items) {
        await this.prisma.discoveryRunItem.update({
          where: { id: item.id },
          data: {
            status: 'failed',
            errorMessage: 'Provider credentials missing. Configure API keys in Settings or .env.',
            providersTriedJson: JSON.stringify([]),
          },
        });
      }

      await this.prisma.discoveryRun.update({
        where: { id: runId },
        data: {
          status: 'waiting_for_credentials',
          completedAt: new Date(),
          errorMessage: 'No configured discovery providers have valid API credentials. Please set API keys in Settings or .env.',
        },
      });
      return;
    }

    let totalDiscoveredContacts = 0;
    let totalCreditsSpent = 0;
    const runErrors: string[] = [];

    for (const item of run.items) {
      if (this.cancelledRuns.has(runId)) {
        await this.prisma.discoveryRun.update({
          where: { id: runId },
          data: { status: 'cancelled' },
        });
        return;
      }

      const targetRoles: string[] = JSON.parse(item.targetRolesJson);
      interface ProviderAttempt {
        provider: ProviderName;
        status: 'found' | 'no_results' | 'error' | 'skipped';
        reason?: string;
      }
      const providerAttempts: ProviderAttempt[] = [];

      try {
        // Stage A: Resolve Company & Domain
        await this.prisma.discoveryRunItem.update({
          where: { id: item.id },
          data: { status: 'resolving_company' },
        });

        let domain = item.companyDomain;
        if (!domain) {
          domain = `${item.companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
        }

        // Stage B & C: Waterfall Execution
        await this.prisma.discoveryRunItem.update({
          where: { id: item.id },
          data: { status: 'searching_contacts' },
        });

        const candidates: DiscoveredPersonProfile[] = [];

        for (const providerKey of providerPriority) {
          const provider = this.providers.get(providerKey);
          const isConfigured = providerStatusMap.get(providerKey) ?? false;

          if (!provider || !isConfigured) {
            providerAttempts.push({
              provider: providerKey,
              status: 'skipped',
              reason: 'Missing API credentials',
            });
            continue;
          }

          provider.clearLastError();

          // Stage: Tomba Domain Search (First Active Provider)
          if (providerKey === 'tomba') {
            const canSpendTomba = await this.budgetService.canSpend('tomba', 1, totalCreditsSpent, config.maxBudget);
            if (!canSpendTomba) {
              providerAttempts.push({
                provider: providerKey,
                status: 'skipped',
                reason: 'Tomba budget cap reached',
              });
              continue;
            }

            const department = NormalizerService.mapRolesToTombaDepartment(targetRoles);
            const country = NormalizerService.mapLocationToCountryCode(item.company?.location || undefined);

            const tombaContacts = await (provider as TombaProvider).searchDomainContacts(domain, targetRoles, {
              department,
              country,
              limit: 10,
            });
            const tombaError = provider.getLastError();

            if (tombaError) {
              providerAttempts.push({
                provider: providerKey,
                status: 'error',
                reason: tombaError,
              });
            } else if (tombaContacts.length === 0) {
              providerAttempts.push({
                provider: providerKey,
                status: 'no_results',
                reason: 'No domain contacts returned from Tomba index',
              });
            } else {
              const matchedContacts: DiscoveredPersonProfile[] = [];
              for (const c of tombaContacts) {
                const jobTitle = c.position || (c as any).title || '';
                const match = NormalizerService.matchTargetRole(jobTitle, targetRoles);
                if (match.isMatch || targetRoles.length === 0) {
                  matchedContacts.push({
                    id: `tomba-${c.email}`,
                    firstName: c.firstName,
                    lastName: c.lastName,
                    fullName: c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email.split('@')[0],
                    jobTitle,
                    companyName: item.companyName,
                    companyDomain: domain,
                    matchedRole: match.matchedRole || targetRoles[0] || 'Target Role',
                    email: c.email,
                    emailStatus: c.status,
                    confidenceScore: c.confidence || 85,
                    sourceProvider: providerKey,
                    sourceUrl: c.sources?.[0]?.uri,
                  });
                }
              }

              if (matchedContacts.length > 0) {
                candidates.push(...matchedContacts);
                providerAttempts.push({
                  provider: providerKey,
                  status: 'found',
                  reason: `Discovered ${matchedContacts.length} contact(s) matching target roles`,
                });
                totalCreditsSpent += 1;
                await this.budgetService.recordUsage('tomba', 1);
              } else {
                providerAttempts.push({
                  provider: providerKey,
                  status: 'no_results',
                  reason: `${tombaContacts.length} contact(s) found at ${domain}, but none matched requested roles (${targetRoles.join(', ')})`,
                });
                totalCreditsSpent += 1;
                await this.budgetService.recordUsage('tomba', 1);
              }
            }
          }

          // Circuit breaker check for Apollo
          if (providerKey === 'apollo') {
            const health = await provider.healthCheck();
            if (!health.canSearch) {
              providerAttempts.push({
                provider: providerKey,
                status: 'skipped',
                reason: health.message || 'Apollo plan restricted: people-search endpoint unavailable',
              });
              continue;
            }
          }

          // Circuit breaker check for Hunter
          if (providerKey === 'hunter') {
            const health = await provider.healthCheck();
            if (!health.canSearch) {
              providerAttempts.push({
                provider: providerKey,
                status: 'skipped',
                reason: health.message || 'Hunter account restricted (429)',
              });
              continue;
            }
          }

          // Stage B: People Search (Apollo, Mock)
          if (providerKey === 'apollo' || providerKey === 'mock') {
            const people = await provider.searchPeople(domain, targetRoles);
            const apolloError = provider.getLastError();

            if (apolloError) {
              providerAttempts.push({
                provider: providerKey,
                status: 'error',
                reason: apolloError,
              });
            } else if (people.length === 0) {
              providerAttempts.push({
                provider: providerKey,
                status: 'no_results',
                reason: 'No profiles returned for domain and target roles',
              });
            } else {
              await this.prisma.discoveryRunItem.update({
                where: { id: item.id },
                data: { status: 'finding_emails' },
              });

              for (const person of people) {
                const match = NormalizerService.matchTargetRole(person.title, targetRoles);
                if (!match.isMatch && targetRoles.length > 0) continue;

                let directEmail: string | undefined;
                let emailStatus: EmailVerificationStatus = 'unverified';
                let confidence = 80;

                const canEnrich =
                  config.allowEnrichment &&
                  (await this.budgetService.canSpend('apollo', 1, totalCreditsSpent, config.maxBudget));

                if (canEnrich) {
                  const enrichResult = await provider.enrichPerson({
                    id: person.providerPersonId,
                    firstName: person.firstName,
                    lastName: person.lastName,
                    domain,
                    organizationName: item.companyName,
                  });

                  if (enrichResult.success && enrichResult.email) {
                    directEmail = enrichResult.email;
                    emailStatus = enrichResult.emailStatus || 'verified';
                    confidence = 95;
                    totalCreditsSpent += enrichResult.creditsConsumed || 1;
                    await this.budgetService.recordUsage('apollo', enrichResult.creditsConsumed || 1);
                  }
                }

                // If no email from Apollo, try Hunter Email Finder fallback
                if (!directEmail && this.providers.has('hunter') && providerStatusMap.get('hunter') && person.firstName && person.lastName) {
                  const hunter = this.providers.get('hunter')!;
                  const canSpendHunter =
                    !config.freeFirstMode &&
                    (await this.budgetService.canSpend('hunter', 1, totalCreditsSpent, config.maxBudget));

                  if (canSpendHunter) {
                    const hunterEmailResult = await hunter.findEmail(domain, person.firstName, person.lastName);
                    if (hunterEmailResult.found && hunterEmailResult.email) {
                      directEmail = hunterEmailResult.email;
                      emailStatus = hunterEmailResult.status;
                      confidence = hunterEmailResult.score || 85;
                      totalCreditsSpent += hunterEmailResult.creditsConsumed || 1;
                      await this.budgetService.recordUsage('hunter', hunterEmailResult.creditsConsumed || 1);
                    }
                  }
                }

                if (directEmail) {
                  candidates.push({
                    id: person.providerPersonId,
                    firstName: person.firstName,
                    lastName: person.lastName,
                    fullName: person.fullName,
                    jobTitle: person.title,
                    companyName: item.companyName,
                    companyDomain: domain,
                    matchedRole: match.matchedRole || targetRoles[0] || 'Target Role',
                    email: directEmail,
                    emailStatus,
                    confidenceScore: confidence,
                    sourceProvider: providerKey,
                    linkedinUrl: person.linkedinUrl,
                  });
                }
              }

              if (candidates.length > 0) {
                providerAttempts.push({
                  provider: providerKey,
                  status: 'found',
                  reason: `Discovered ${candidates.length} contact(s)`,
                });
              } else {
                providerAttempts.push({
                  provider: providerKey,
                  status: 'no_results',
                  reason: 'Found profiles but no verified direct email was resolvable',
                });
              }
            }
          }

          // Stage C: Domain Contacts Search (Hunter, Snov, Mock, OfficialWeb)
          if (candidates.length === 0 && (providerKey === 'hunter' || providerKey === 'snov' || providerKey === 'mock' || providerKey === 'official_website')) {
            const domainContacts = await provider.searchDomainContacts(domain, targetRoles);
            const domainError = provider.getLastError();

            if (domainError) {
              providerAttempts.push({
                provider: providerKey,
                status: 'error',
                reason: domainError,
              });
            } else if (domainContacts.length === 0) {
              providerAttempts.push({
                provider: providerKey,
                status: 'no_results',
                reason: 'No domain contacts returned from public index',
              });
            } else {
              for (const c of domainContacts) {
                const match = NormalizerService.matchTargetRole(c.position, targetRoles);
                if (match.isMatch || targetRoles.length === 0) {
                  candidates.push({
                    id: `${providerKey}-${c.email}`,
                    firstName: c.firstName,
                    lastName: c.lastName,
                    fullName: c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email.split('@')[0],
                    jobTitle: c.position,
                    companyName: item.companyName,
                    companyDomain: domain,
                    matchedRole: match.matchedRole || targetRoles[0] || 'Target Role',
                    email: c.email,
                    emailStatus: c.status,
                    confidenceScore: c.confidence || 85,
                    sourceProvider: providerKey,
                    sourceUrl: c.sources?.[0]?.uri,
                  });
                }
              }

              if (candidates.length > 0) {
                providerAttempts.push({
                  provider: providerKey,
                  status: 'found',
                  reason: `Discovered ${candidates.length} contact(s)`,
                });
              } else {
                providerAttempts.push({
                  provider: providerKey,
                  status: 'no_results',
                  reason: 'Domain contacts found but none matched target roles',
                });
              }
            }
          }

          // If candidates found, stop waterfall for this company
          if (candidates.length > 0) {
            break;
          }
        }

        // Stage E: Verification & Persistence
        await this.prisma.discoveryRunItem.update({
          where: { id: item.id },
          data: { status: 'verifying' },
        });

        let itemContactsSaved = 0;
        for (const candidate of candidates) {
          if (!candidate.email) continue;
          const normalizedEmail = NormalizerService.normalizeEmail(candidate.email);

          let status = candidate.emailStatus;
          if (config.verifyEmails && (status === 'unverified' || status === 'unknown')) {
            const verifyRes = await this.verificationService.verifyEmail(normalizedEmail, false);
            status = verifyRes.status;
          }

          const contact = await this.prisma.contact.upsert({
            where: { email: normalizedEmail },
            update: {
              firstName: candidate.firstName,
              lastName: candidate.lastName,
              fullName: candidate.fullName,
              jobTitle: candidate.jobTitle,
              companyId: item.companyId,
              companyName: item.companyName,
              companyDomain: domain,
              matchedRole: candidate.matchedRole,
              primarySource: candidate.sourceProvider,
              emailStatus: status,
              confidenceScore: candidate.confidenceScore,
            },
            create: {
              email: normalizedEmail,
              firstName: candidate.firstName,
              lastName: candidate.lastName,
              fullName: candidate.fullName,
              jobTitle: candidate.jobTitle,
              companyId: item.companyId,
              companyName: item.companyName,
              companyDomain: domain,
              matchedRole: candidate.matchedRole,
              primarySource: candidate.sourceProvider,
              emailStatus: status,
              confidenceScore: candidate.confidenceScore,
            },
          });

          await this.prisma.contactSource.create({
            data: {
              contactId: contact.id,
              provider: candidate.sourceProvider,
              providerPersonId: candidate.id,
              rawTitle: candidate.jobTitle,
              rawEmail: candidate.email,
              sourceUrl: candidate.sourceUrl || candidate.linkedinUrl,
              confidence: candidate.confidenceScore,
            },
          });

          await this.prisma.emailVerification.create({
            data: {
              contactId: contact.id,
              provider: candidate.sourceProvider,
              status: status,
              score: candidate.confidenceScore,
            },
          });

          itemContactsSaved++;
        }

        totalDiscoveredContacts += itemContactsSaved;

        const itemErrors = providerAttempts
          .filter((a) => a.status === 'error' && a.reason)
          .map((a) => `${a.provider}: ${a.reason}`)
          .join('; ');

        if (itemErrors) {
          runErrors.push(`${item.companyName} (${itemErrors})`);
        }

        await this.prisma.discoveryRunItem.update({
          where: { id: item.id },
          data: {
            status: itemContactsSaved > 0 ? 'completed' : itemErrors ? 'failed' : 'completed',
            contactsFound: itemContactsSaved,
            errorMessage: itemContactsSaved === 0 && itemErrors ? itemErrors : null,
            providersTriedJson: JSON.stringify(providerAttempts),
          },
        });
      } catch (err: any) {
        logger.error(`Company discovery failed for ${item.companyName}`, err);
        runErrors.push(`${item.companyName}: ${err.message}`);
        await this.prisma.discoveryRunItem.update({
          where: { id: item.id },
          data: {
            status: 'failed',
            errorMessage: err.message,
            providersTriedJson: JSON.stringify(providerAttempts),
          },
        });
      }

      await this.prisma.discoveryRun.update({
        where: { id: runId },
        data: {
          processedCompanies: { increment: 1 },
          contactsFound: totalDiscoveredContacts,
          creditsConsumed: totalCreditsSpent,
        },
      });
    }

    // Determine final status
    let finalStatus = 'completed_with_results';
    let finalErrorMessage: string | null = null;

    if (totalDiscoveredContacts > 0) {
      if (runErrors.length > 0) {
        finalStatus = 'partially_completed';
        finalErrorMessage = `Partially completed: ${totalDiscoveredContacts} contact(s) saved, but provider restrictions occurred: ${runErrors.join(' | ')}`;
      } else {
        finalStatus = 'completed_with_results';
      }
    } else {
      if (runErrors.length > 0) {
        finalStatus = 'blocked_by_provider';
        finalErrorMessage = `Discovery blocked or restricted by providers: ${runErrors.join(' | ')}. Action: Use CSV Import or configure upgraded API plans.`;
      } else {
        finalStatus = 'completed_no_results';
        finalErrorMessage = 'Search completed across providers, but 0 contacts matched your target roles. Action: Broaden roles or import from CSV.';
      }
    }

    await this.prisma.discoveryRun.update({
      where: { id: runId },
      data: {
        status: finalStatus,
        completedAt: new Date(),
        contactsFound: totalDiscoveredContacts,
        creditsConsumed: totalCreditsSpent,
        errorMessage: finalErrorMessage,
      },
    });
  }
}
